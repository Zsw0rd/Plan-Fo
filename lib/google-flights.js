const { createQuery, fetchFlights } = require("google-flights-scraper");

const MAX_RESULTS_PER_CATEGORY = 12;
const GOOGLE_FLIGHTS_BOOKING_RPC_URL = "https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetBookingResults";
const GOOGLE_FLIGHTS_CLK_URL = "https://www.google.com/travel/clk/f";
const GOOGLE_FLIGHTS_HEADERS = {
    "accept": "*/*",
    "accept-language": "en-IN,en;q=0.9",
    "cache-control": "no-cache",
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "origin": "https://www.google.com",
    "pragma": "no-cache",
    "referer": "https://www.google.com/travel/flights/search",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
};

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

function buildGoogleFlightsUrl(searchQuery, bookingToken = "") {
    const params = new URLSearchParams(searchQuery.params);
    const page = bookingToken ? "booking" : "search";

    if (bookingToken) {
        params.set("tfu", bookingToken);
    }

    return `https://www.google.com/travel/flights/${page}?${params.toString()}`;
}

function safeGet(value, path, fallback = undefined) {
    let current = value;

    for (const key of path) {
        if (!Array.isArray(current) || current.length <= key) {
            return fallback;
        }

        current = current[key];
    }

    return current === undefined ? fallback : current;
}

function buildBookingSegment(origin, destination, date, selectedLegs) {
    return [
        [[[origin, 0]]],
        [[[destination, 0]]],
        null,
        0,
        null,
        null,
        date,
        null,
        selectedLegs,
        null,
        null,
        null,
        null,
        null,
        3
    ];
}

function buildBookingRequestBody({ bookingToken, origin, destination, departureDate, selectedLegs }) {
    const filterBlock = [
        null,
        null,
        2,
        null,
        [],
        1,
        [1, 0, 0, 0],
        null,
        null,
        null,
        null,
        null,
        null,
        [buildBookingSegment(origin, destination, departureDate, selectedLegs)],
        null,
        null,
        null,
        1,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null
    ];
    const payload = [[null, bookingToken], filterBlock, null, 0];
    const wrappedPayload = JSON.stringify([null, JSON.stringify(payload)]);

    return `f.req=${encodeURIComponent(wrappedPayload)}`;
}

function parseBookingResults(text) {
    const stripped = text.replace(/^\)\]\}'\s*/, "");
    let frames;

    try {
        frames = JSON.parse(stripped);
    } catch (_error) {
        return [];
    }

    if (!Array.isArray(frames)) {
        return [];
    }

    const rawOptions = [];

    for (const frame of frames) {
        if (!Array.isArray(frame) || frame[0] !== "wrb.fr" || typeof frame[2] !== "string") {
            continue;
        }

        try {
            const payload = JSON.parse(frame[2]);
            const options = safeGet(payload, [1, 0], []);

            if (Array.isArray(options)) {
                rawOptions.push(...options.filter(Array.isArray));
            }
        } catch (_error) {
            continue;
        }
    }

    return rawOptions.map(parseBookingOption).filter((option) => option.bookingUrl);
}

function parseBookingOption(option) {
    const seller = safeGet(option, [1, 0], []);
    const price = safeGet(option, [7, 0, 1], null);
    const brandLabel = String(safeGet(option, [21, 3], "") || "");
    const bookingBaseUrl = safeGet(option, [5, 2, 0], "");
    const bookingParams = safeGet(option, [5, 2, 1], []);
    let bookingUrl = "";

    if (bookingBaseUrl === GOOGLE_FLIGHTS_CLK_URL && Array.isArray(bookingParams)) {
        const params = new URLSearchParams();

        bookingParams.forEach((pair) => {
            if (Array.isArray(pair) && pair.length >= 2 && pair[0] != null && pair[1] != null) {
                params.set(String(pair[0]), String(pair[1]));
            }
        });

        if (params.has("u")) {
            bookingUrl = `${bookingBaseUrl}?${params.toString()}`;
        }
    }

    return {
        sellerName: String(seller[1] || ""),
        sellerCode: String(seller[0] || ""),
        price: typeof price === "number" ? Math.round(price) : null,
        brandLabel,
        isAirlineDirect: seller[3] === true,
        bookingUrl
    };
}

function buildSelectedLegs(offer) {
    return (offer.segments || []).map((segment) => [
        segment.from,
        segment.departureAt.slice(0, 10),
        segment.to,
        null,
        segment.carrier,
        String(segment.flightNumber || "").replace(/^[A-Z0-9]{2}/, "")
    ]);
}

async function fetchBookingOptions({ bookingToken, origin, destination, departureDate, selectedLegs }) {
    if (!bookingToken || !selectedLegs?.length) {
        return [];
    }

    if (!selectedLegs.length || selectedLegs.some((leg) => leg.some((value, index) => index !== 3 && !value))) {
        return [];
    }

    const body = buildBookingRequestBody({
        bookingToken,
        origin,
        destination,
        departureDate,
        selectedLegs
    });
    const response = await fetch(GOOGLE_FLIGHTS_BOOKING_RPC_URL, {
        method: "POST",
        headers: GOOGLE_FLIGHTS_HEADERS,
        body
    });

    if (!response.ok) {
        return [];
    }

    return parseBookingResults(await response.text())
        .sort((first, second) => {
            if (first.isAirlineDirect !== second.isAirlineDirect) {
                return first.isAirlineDirect ? -1 : 1;
            }

            return (first.price ?? Number.MAX_SAFE_INTEGER) - (second.price ?? Number.MAX_SAFE_INTEGER);
        });
}

async function getBookingRedirect({ bookingToken, origin, destination, departureDate, selectedLegs }) {
    const bookingOptions = await fetchBookingOptions({
        bookingToken,
        origin,
        destination,
        departureDate,
        selectedLegs
    });

    return bookingOptions[0]?.bookingUrl || "";
}

function normalizeFlight(flight, index, searchQuery) {
    const segments = flight.segments || [];
    const stopCount = Math.max(segments.length - 1, 0);
    const connectionAirports = segments.slice(0, -1).map((segment) => segment.toAirport?.code).filter(Boolean);
    const firstSegment = segments[0];
    const lastSegment = segments[segments.length - 1];
    const bookingToken = flight.bookingToken || "";

    return {
        id: String(index),
        bookingToken,
        price: Number(flight.price || 0),
        currency: "INR",
        duration: formatMinutes(flight.totalDurationMinutes),
        stops: stopCount,
        type: segments.length <= 1 ? "direct" : "connecting",
        googleFlightsUrl: buildGoogleFlightsUrl(searchQuery),
        selectedGoogleFlightsUrl: buildGoogleFlightsUrl(searchQuery, bookingToken),
        departureAt: segmentDateTime(firstSegment, "departure"),
        arrivalAt: segmentDateTime(lastSegment, "arrival"),
        originCode: firstSegment?.fromAirport?.code || "",
        destinationCode: lastSegment?.toAirport?.code || "",
        airlines: flight.airlines || [],
        connectionAirports,
        selectedLegs: buildSelectedLegs({
            segments: segments.map((segment) => ({
                from: segment.fromAirport?.code || "",
                to: segment.toAirport?.code || "",
                departureAt: segmentDateTime(segment, "departure"),
                carrier: segment.operatingCarrier || "",
                flightNumber: segment.flightNumber || ""
            }))
        }),
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

    const result = await fetchFlights(
        searchQueryInput,
        {
            transport: "auto",
            timeoutMs: Number(process.env.FLIGHT_SCRAPER_TIMEOUT_MS || 30000),
            retry: {
                attempts: 2,
                baseDelayMs: 800,
                maxDelayMs: 4000
            }
        }
    );

    const offers = (result.flights || [])
        .map((flight, index) => normalizeFlight(flight, index, searchQuery))
        .filter((offer) => offer.departureAt.startsWith(departureDate))
        .filter((offer) => offer.price > 0)
        .sort((firstOffer, secondOffer) => firstOffer.price - secondOffer.price);

    const direct = offers.filter((offer) => offer.type === "direct").slice(0, MAX_RESULTS_PER_CATEGORY);
    const connecting = offers.filter((offer) => offer.type === "connecting").slice(0, MAX_RESULTS_PER_CATEGORY);

    return {
        origin,
        destination,
        departureDate,
        fetchedAt: new Date().toISOString(),
        source: "google-flights",
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
    getBookingRedirect,
    searchFlightOffers
};
