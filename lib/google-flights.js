const { createQuery, fetchFlights } = require("google-flights-scraper");

const MAX_RESULTS_PER_CATEGORY = 12;
const DEFAULT_FLIGHT_SCRAPER_TRANSPORT = "rpc";

function isValidIataCode(code) {
    return typeof code === "string" && /^[A-Z]{3}$/.test(code);
}

function isValidDate(date) {
    return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function pad(value) {
    return String(value).padStart(2, "0");
}

function segmentDateTime(segment, kind) {
    const point = segment?.[kind];

    if (!point?.date || !point?.time) {
        return "";
    }

    return `${point.date.year}-${pad(point.date.month)}-${pad(point.date.day)}T${pad(point.time.hour)}:${pad(point.time.minute)}:00`;
}

function formatMinutes(totalMinutes) {
    const minutes = Number(totalMinutes || 0);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;

    if (hours && remainder) {
        return `${hours}h ${remainder}m`;
    }

    if (hours) {
        return `${hours}h`;
    }

    return `${remainder}m`;
}

function normalizePrice(price) {
    const numericPrice = Number(price);

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
        return null;
    }

    return Math.round(numericPrice);
}

function getConnectionAirports(flight, segments) {
    const layoverAirports = (flight.layovers || [])
        .map((layover) => layover.airportCode)
        .filter(Boolean);

    if (layoverAirports.length) {
        return layoverAirports;
    }

    return segments.slice(0, -1)
        .map((segment) => segment.toAirport?.code)
        .filter(Boolean);
}

function getFlightType(segments, connectionAirports) {
    return segments.length <= 1 && connectionAirports.length === 0 ? "direct" : "connecting";
}

function createOfferDedupeKey(offer) {
    if (offer.bookingToken) {
        return `token:${offer.bookingToken}`;
    }

    const segmentKey = offer.segments
        .map((segment) => `${segment.flightNumber}:${segment.from}-${segment.to}:${segment.departureAt}`)
        .join("|");

    return `${offer.price}:${segmentKey}`;
}

function dedupeOffers(offers) {
    const seen = new Set();

    return offers.filter((offer) => {
        const key = createOfferDedupeKey(offer);

        if (seen.has(key)) {
            return false;
        }

        seen.add(key);
        return true;
    });
}

function encodeVarint(value) {
    const bytes = [];
    let remaining = value;

    while (remaining > 0x7f) {
        bytes.push((remaining & 0x7f) | 0x80);
        remaining >>>= 7;
    }

    bytes.push(remaining);
    return bytes;
}

function buildGoogleFlightsSelectionToken(bookingToken) {
    if (!bookingToken) {
        return "";
    }

    const tokenBytes = Buffer.from(bookingToken, "utf8");
    const wrappedBytes = Buffer.from([
        0x0a,
        ...encodeVarint(tokenBytes.length),
        ...tokenBytes,
        0x12,
        0x02,
        0x08,
        0x01
    ]);

    return wrappedBytes.toString("base64");
}

function buildGoogleFlightsUrl(searchQuery, bookingToken = "") {
    const params = new URLSearchParams(searchQuery.params);
    const selectionToken = buildGoogleFlightsSelectionToken(bookingToken);
    const page = selectionToken ? "booking" : "search";

    if (selectionToken) {
        params.set("tfu", selectionToken);
    }

    return `https://www.google.com/travel/flights/${page}?${params.toString()}`;
}

function normalizeFlight(flight, index, searchQuery) {
    const segments = flight.segments || [];
    const connectionAirports = getConnectionAirports(flight, segments);
    const stopCount = connectionAirports.length;
    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1];
    const bookingToken = flight.bookingToken || "";
    const price = normalizePrice(flight.price);

    return {
        id: String(index),
        bookingToken,
        price,
        currency: "INR",
        duration: formatMinutes(flight.totalDurationMinutes),
        stops: stopCount,
        scraperStopCount: Number.isFinite(flight.stopCount) ? flight.stopCount : null,
        type: getFlightType(segments, connectionAirports),
        googleFlightsUrl: buildGoogleFlightsUrl(searchQuery),
        selectedGoogleFlightsUrl: buildGoogleFlightsUrl(searchQuery, bookingToken),
        departureAt: segmentDateTime(firstSegment, "departure"),
        arrivalAt: segmentDateTime(lastSegment, "arrival"),
        originCode: firstSegment?.fromAirport?.code || "",
        destinationCode: lastSegment?.toAirport?.code || "",
        airlines: flight.airlines || [],
        connectionAirports,
        segments: segments.map((segment) => ({
            from: segment.fromAirport?.code || "",
            to: segment.toAirport?.code || "",
            departureAt: segmentDateTime(segment, "departure"),
            arrivalAt: segmentDateTime(segment, "arrival"),
            carrier: segment.operatingCarrier || "",
            flightNumber: segment.flightNumber || "",
            duration: formatMinutes(segment.durationMinutes)
        }))
    };
}

async function fetchFlightResults(searchQueryInput) {
    const transport = process.env.FLIGHT_SCRAPER_TRANSPORT || DEFAULT_FLIGHT_SCRAPER_TRANSPORT;
    const options = {
        transport,
        timeoutMs: Number(process.env.FLIGHT_SCRAPER_TIMEOUT_MS || 30000),
        retry: {
            attempts: 2,
            baseDelayMs: 800,
            maxDelayMs: 4000
        }
    };

    try {
        return {
            result: await fetchFlights(searchQueryInput, options),
            transport
        };
    } catch (error) {
        if (transport === "auto") {
            throw error;
        }

        const fallbackOptions = {
            ...options,
            transport: "auto"
        };

        return {
            result: await fetchFlights(searchQueryInput, fallbackOptions),
            transport: "auto"
        };
    }
}

async function searchFlightOffers({ origin, destination, departureDate }) {
    if (!isValidIataCode(origin) || !isValidIataCode(destination)) {
        throw new Error("Origin and destination must be valid 3-letter airport codes.");
    }

    if (origin === destination) {
        throw new Error("Origin and destination must be different.");
    }

    if (!isValidDate(departureDate)) {
        throw new Error("departureDate must use YYYY-MM-DD format.");
    }

    const searchQueryInput = {
        flights: [{ date: departureDate, fromAirport: origin, toAirport: destination }],
        seat: "economy",
        passengers: { adults: 1 },
        language: "en-IN",
        currency: "INR",
        region: "IN",
        trip: "one-way"
    };
    const searchQuery = createQuery(searchQueryInput);

    const { result, transport } = await fetchFlightResults(searchQueryInput);

    const offers = dedupeOffers((result.flights || [])
        .map((flight, index) => normalizeFlight(flight, index, searchQuery))
        .filter((offer) => offer.price !== null))
        .sort((firstOffer, secondOffer) => firstOffer.price - secondOffer.price);

    const direct = offers.filter((offer) => offer.type === "direct").slice(0, MAX_RESULTS_PER_CATEGORY);
    const connecting = offers.filter((offer) => offer.type === "connecting").slice(0, MAX_RESULTS_PER_CATEGORY);

    return {
        origin,
        destination,
        departureDate,
        fetchedAt: new Date().toISOString(),
        source: "google-flights",
        sourceTransport: transport,
        direct,
        connecting,
        meta: {
            total: direct.length + connecting.length,
            cheapestDirect: direct[0]?.price ?? null,
            cheapestConnecting: connecting[0]?.price ?? null
        }
    };
}

module.exports = {
    searchFlightOffers,
    _private: {
        normalizeFlight,
        normalizePrice,
        dedupeOffers
    }
};
