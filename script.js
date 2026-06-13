function openPlanePage(page) {
    window.location.href = page;
}

function filterPlaneCards() {
    const searchBar = document.getElementById("searchBar");
    const noResultsMessage = document.getElementById("noResultsMessage");

    if (!searchBar) {
        return;
    }

    const query = searchBar.value.toLowerCase();
    const planeCards = document.querySelectorAll(".plane-card");
    let anyVisible = false;

    planeCards.forEach((card) => {
        const planeName = card.querySelector("h3").textContent.toLowerCase();

        if (planeName.includes(query)) {
            card.style.display = "";
            anyVisible = true;
        } else {
            card.style.display = "none";
        }
    });

    if (noResultsMessage) {
        noResultsMessage.style.display = anyVisible ? "none" : "block";
    }
}

window.openPlanePage = openPlanePage;
window.filterPlaneCards = filterPlaneCards;

const flightApiConfig = {
    endpoint: "/api/flights"
};

const indianAirports = [
    { city: "Bengaluru", code: "BLR", airport: "Kempegowda International Airport" },
    { city: "New Delhi", code: "DEL", airport: "Indira Gandhi International Airport" },
    { city: "Mumbai", code: "BOM", airport: "Chhatrapati Shivaji Maharaj International Airport" },
    { city: "Hyderabad", code: "HYD", airport: "Rajiv Gandhi International Airport" },
    { city: "Chennai", code: "MAA", airport: "Chennai International Airport" },
    { city: "Kolkata", code: "CCU", airport: "Netaji Subhas Chandra Bose International Airport" },
    { city: "Goa", code: "GOI", airport: "Goa International Airport" },
    { city: "Ahmedabad", code: "AMD", airport: "Sardar Vallabhbhai Patel International Airport" },
    { city: "Kochi", code: "COK", airport: "Cochin International Airport" },
    { city: "Jaipur", code: "JAI", airport: "Jaipur International Airport" }
];

const bookingSites = [
    {
        name: "Book selected flight",
        title: "Open the booking option for this exact selected itinerary",
        builder: buildGoogleFlightsUrl
    }
];

let activeFlightCategory = "all";
let latestFlightSearch = null;

document.addEventListener("DOMContentLoaded", () => {
    addFlightShortcut();
    initializeFlightExplorer();
});

function addFlightShortcut() {
    if (document.querySelector(".floating-feature-link")) {
        return;
    }

    const currentPage = window.location.pathname.split("/").pop();

    if (currentPage === "flights.html") {
        return;
    }

    const shortcut = document.createElement("a");
    shortcut.href = "flights.html";
    shortcut.className = "floating-feature-link";
    shortcut.textContent = "Flight Explorer";
    document.body.appendChild(shortcut);
}

async function initializeFlightExplorer() {
    const resultsContainer = document.getElementById("directFlights");

    if (!resultsContainer) {
        return;
    }

    const originSelect = document.getElementById("originCity");
    const destinationSelect = document.getElementById("destinationCity");
    const departureInput = document.getElementById("departureDate");
    const budgetInput = document.getElementById("budgetInput");
    const searchButton = document.getElementById("searchFlightsBtn");

    populateAirportSelect(originSelect);
    populateAirportSelect(destinationSelect, originSelect.value);
    departureInput.value = getDefaultDepartureDate();
    departureInput.min = formatDateInputValue(new Date());

    originSelect.addEventListener("change", () => {
        populateAirportSelect(destinationSelect, originSelect.value, destinationSelect.value);
    });

    searchButton.addEventListener("click", () => {
        searchLiveFlights();
    });

    document.querySelectorAll(".flight-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
            setActiveFlightCategory(tab.dataset.category);
        });
    });

    renderInitialFlightState();
}

function populateAirportSelect(selectElement, excludeCode = "", selectedCode = "") {
    const options = indianAirports.filter((airport) => airport.code !== excludeCode);

    selectElement.innerHTML = options.map((airport) => {
        const selected = airport.code === selectedCode ? " selected" : "";
        return `<option value="${airport.code}"${selected}>${airport.city} (${airport.code})</option>`;
    }).join("");

    if (!selectElement.value && options.length) {
        selectElement.value = options[0].code;
    }
}

function getDefaultDepartureDate() {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return formatDateInputValue(date);
}

function formatDateInputValue(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function getAirportByCode(code) {
    return indianAirports.find((airport) => airport.code === code) || { city: code, code, airport: code };
}

function renderInitialFlightState() {
    const summary = document.getElementById("flightSummary");
    summary.innerHTML = "";

    renderFlightSections([], [], {
        originCode: document.getElementById("originCity").value,
        destinationCode: document.getElementById("destinationCity").value,
        departureDate: document.getElementById("departureDate").value,
        isPlaceholder: true
    });
}

async function searchLiveFlights() {
    const originCode = document.getElementById("originCity").value;
    const destinationCode = document.getElementById("destinationCity").value;
    const departureDate = document.getElementById("departureDate").value;
    const budgetValue = Number(document.getElementById("budgetInput").value);
    const summary = document.getElementById("flightSummary");
    const searchButton = document.getElementById("searchFlightsBtn");

    if (!originCode || !destinationCode || !departureDate) {
        summary.innerHTML = "<p><strong>Please choose origin, destination, and a departure date.</strong></p>";
        return;
    }

    if (originCode === destinationCode) {
        summary.innerHTML = "<p><strong>Origin and destination must be different cities.</strong></p>";
        return;
    }

    searchButton.disabled = true;
    searchButton.textContent = "Searching...";
    summary.innerHTML = "<p>Fetching live flight offers. This may take a few seconds...</p>";
    setFlightGridLoading(true);

    try {
        const payload = await fetchLiveFlightOffers(originCode, destinationCode, departureDate);
        latestFlightSearch = {
            ...payload,
            budgetValue
        };

        renderFlightSearchResults(latestFlightSearch);
    } catch (error) {
        console.warn("Live flight search failed.", error);
        summary.innerHTML = `
            <p><strong>Live prices could not be loaded.</strong> ${escapeHtml(error.message)}</p>
            <p>Try a different date or use the Google Flights link below.</p>
        `;

        renderFlightSections([], [], {
            originCode,
            destinationCode,
            departureDate,
            showDeepLinksOnly: true
        });
    } finally {
        searchButton.disabled = false;
        searchButton.textContent = "Search Live Flights";
        setFlightGridLoading(false);
    }
}

async function fetchLiveFlightOffers(originCode, destinationCode, departureDate) {
    const params = new URLSearchParams({
        origin: originCode,
        destination: destinationCode,
        departureDate,
        _: String(Date.now())
    });
    const response = await fetch(`${flightApiConfig.endpoint}?${params.toString()}`, {
        cache: "no-store"
    });

    if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        throw new Error(errorPayload.error || errorPayload.details || "Flight search failed.");
    }

    return response.json();
}

function renderFlightSearchResults(searchResult) {
    const summary = document.getElementById("flightSummary");
    const origin = getAirportByCode(searchResult.origin);
    const destination = getAirportByCode(searchResult.destination);
    const budgetValue = searchResult.budgetValue;
    let directOffers = searchResult.direct || [];
    let connectingOffers = searchResult.connecting || [];

    if (budgetValue) {
        directOffers = directOffers.filter((offer) => offer.price <= budgetValue);
        connectingOffers = connectingOffers.filter((offer) => offer.price <= budgetValue);
    }

    const cheapestDirect = directOffers[0];
    const cheapestConnecting = connectingOffers[0];
    const fetchedAt = searchResult.fetchedAt ? formatFetchedAt(searchResult.fetchedAt) : "just now";

    if (!directOffers.length && !connectingOffers.length) {
        summary.innerHTML = `
            <p><strong>No flights matched your filters</strong> for ${origin.city} (${origin.code}) to ${destination.city} (${destination.code}) on ${formatDisplayDate(searchResult.departureDate)}.</p>
            <p>Try a different date, raise your budget, or use the Google Flights link to search live inventory.</p>
        `;
    } else {
        const directText = cheapestDirect
            ? `Cheapest direct: <strong>${formatCurrency(cheapestDirect.price, cheapestDirect.currency)}</strong>`
            : "No direct flights found";
        const connectingText = cheapestConnecting
            ? `Cheapest connecting: <strong>${formatCurrency(cheapestConnecting.price, cheapestConnecting.currency)}</strong>`
            : "No connecting flights found";

        summary.innerHTML = `
            <p><strong>${directOffers.length + connectingOffers.length}</strong> live offers for <strong>${origin.city} â†’ ${destination.city}</strong> on <strong>${formatDisplayDate(searchResult.departureDate)}</strong>.</p>
            <p>${directText}. ${connectingText}.</p>
            <p>Prices last checked ${fetchedAt}. Confirm the final fare before booking.</p>
        `;
    }

    renderFlightSections(directOffers, connectingOffers, searchResult);
}

function renderFlightSections(directOffers, connectingOffers, context) {
    const directContainer = document.getElementById("directFlights");
    const connectingContainer = document.getElementById("connectingFlights");
    const directCount = document.getElementById("directCount");
    const connectingCount = document.getElementById("connectingCount");

    directCount.textContent = String(directOffers.length);
    connectingCount.textContent = String(connectingOffers.length);

    if (context.showDeepLinksOnly) {
        const placeholderOffer = buildDeepLinkPlaceholder(context);
        directContainer.innerHTML = createFlightCard(placeholderOffer, context, "direct");
        connectingContainer.innerHTML = createFlightCard(placeholderOffer, context, "connecting");
    } else if (context.isPlaceholder) {
        directContainer.innerHTML = createEmptyState("Search a route to see direct flight options.");
        connectingContainer.innerHTML = createEmptyState("Search a route to see connecting flight options.");
    } else {
        directContainer.innerHTML = directOffers.length
            ? directOffers.map((offer) => createFlightCard(offer, context, "direct")).join("")
            : createEmptyState("No direct flights found for this search. Try another date or check connecting options.");
        connectingContainer.innerHTML = connectingOffers.length
            ? connectingOffers.map((offer) => createFlightCard(offer, context, "connecting")).join("")
            : createEmptyState("No connecting flights found for this search.");
    }

    applyFlightCategoryVisibility();
    attachCopyListeners();
}

function buildDeepLinkPlaceholder(context) {
    return {
        price: null,
        currency: "INR",
        duration: "Check live sites",
        airlines: ["Check Google Flights"],
        stops: 0,
        connectionAirports: [],
        departureAt: "",
        arrivalAt: "",
        segments: []
    };
}

function createEmptyState(message) {
    return `
        <article class="empty-state">
            <h3>No results in this category</h3>
            <p>${message}</p>
        </article>
    `;
}

function setActiveFlightCategory(category) {
    activeFlightCategory = category;

    document.querySelectorAll(".flight-tab").forEach((tab) => {
        const isActive = tab.dataset.category === category;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });

    applyFlightCategoryVisibility();
}

function applyFlightCategoryVisibility() {
    const directSection = document.getElementById("directSection");
    const connectingSection = document.getElementById("connectingSection");

    directSection.hidden = activeFlightCategory === "connecting";
    connectingSection.hidden = activeFlightCategory === "direct";
}

function setFlightGridLoading(isLoading) {
    document.querySelectorAll(".flight-grid").forEach((grid) => {
        grid.classList.toggle("is-loading", isLoading);
    });
}

function createFlightCard(offer, context, category) {
    const origin = getAirportByCode(context.originCode || context.origin);
    const destination = getAirportByCode(context.destinationCode || context.destination);
    const departureDate = context.departureDate;
    const typeLabel = category === "direct" ? "Direct" : "Connecting";
    const stopsText = category === "direct"
        ? "Non-stop"
        : offer.connectionAirports?.length
            ? `Via ${offer.connectionAirports.join(", ")}`
            : `${offer.stops || 1} stop${(offer.stops || 1) > 1 ? "s" : ""}`;

    const siteLinks = bookingSites.map((site) => {
        const url = site.builder({
            originCode: origin.code,
            destinationCode: destination.code,
            departureDate,
            category,
            offer
        });
        const title = site.title ? ` title="${escapeHtml(site.title)}"` : "";
        const label = offer.bookingSellerName
            ? `Book with ${offer.bookingSellerName}`
            : site.name;

        return `
            <a class="booking-site-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"${title}>
                ${escapeHtml(label)}
            </a>
        `;
    }).join("");

    const priceMarkup = offer.price
        ? `<p class="flight-price">${formatCurrency(offer.price, offer.currency)}</p>`
        : `<p class="flight-price flight-price-muted">Live price unavailable</p>`;

    const scheduleMarkup = offer.departureAt && offer.arrivalAt
        ? `<p><strong>Departs:</strong> ${formatDateTime(offer.departureAt)}</p>
           <p><strong>Arrives:</strong> ${formatDateTime(offer.arrivalAt)}</p>`
        : `<p><strong>Date:</strong> ${formatDisplayDate(departureDate)}</p>`;

    const segmentMarkup = offer.segments?.length
        ? `<p><strong>Itinerary:</strong> ${offer.segments.map((segment) => `${segment.flightNumber} (${segment.from}â†’${segment.to})`).join(", ")}</p>`
        : "";

    const copyText = [
        `${origin.city} (${origin.code}) to ${destination.city} (${destination.code})`,
        typeLabel,
        departureDate,
        offer.price ? formatCurrency(offer.price, offer.currency) : "Check live sites"
    ].join(" | ");

    return `
        <article class="flight-card">
            <div class="flight-card-header">
                <div>
                    <h3>${destination.city}</h3>
                    <p class="flight-route-code">${origin.code} â†’ ${destination.code}</p>
                </div>
                ${priceMarkup}
            </div>

            <div class="flight-meta">
                <p><strong>Type:</strong> ${typeLabel}</p>
                <p><strong>Route:</strong> ${stopsText}</p>
                <p><strong>Duration:</strong> ${offer.duration || "â€”"}</p>
                <p><strong>Airlines:</strong> ${(offer.airlines || []).join(", ") || "â€”"}</p>
                ${scheduleMarkup}
                ${segmentMarkup}
            </div>

            <div class="flight-tags">
                <span class="flight-tag">${typeLabel}</span>
                <span class="flight-tag">${stopsText}</span>
            </div>

            <div class="flight-actions">
                ${siteLinks}
                <button class="copy-route-button" type="button" data-route="${escapeHtml(copyText)}">
                    Copy Route
                </button>
            </div>
        </article>
    `;
}

function buildGoogleFlightsUrl({ originCode, destinationCode, departureDate, category, offer }) {
    if (offer?.selectedGoogleFlightsUrl) {
        return offer.selectedGoogleFlightsUrl;
    }

    if (offer?.googleFlightsUrl) {
        return offer.googleFlightsUrl;
    }

    const stopHint = category === "direct" ? " nonstop" : "";
    const flightHint = getOfferFlightNumbers(offer).join(" ");
    const query = `Flights from ${originCode} to ${destinationCode} on ${departureDate}${stopHint} ${flightHint}`.trim();
    return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}&hl=en&curr=INR&gl=in`;
}

function getOfferFlightNumbers(offer) {
    return (offer?.segments || [])
        .map((segment) => segment.flightNumber)
        .filter(Boolean);
}

function attachCopyListeners() {
    document.querySelectorAll(".copy-route-button").forEach((button) => {
        button.onclick = async () => {
            const routeText = button.dataset.route || "";
            const didCopy = await copyText(routeText);
            const originalText = button.textContent;
            button.textContent = didCopy ? "Copied" : "Copy failed";
            window.setTimeout(() => {
                button.textContent = originalText;
            }, 1400);
        };
    });
}

async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (error) {
            console.warn("Clipboard API copy failed.", error);
        }
    }

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "absolute";
    helper.style.left = "-9999px";
    document.body.appendChild(helper);
    helper.select();

    try {
        return document.execCommand("copy");
    } catch (error) {
        console.warn("Copy failed.", error);
        return false;
    } finally {
        document.body.removeChild(helper);
    }
}

function formatCurrency(amount, currency = "INR") {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
        maximumFractionDigits: 0
    }).format(amount);
}

function formatDisplayDate(dateValue) {
    if (!dateValue) {
        return "";
    }

    const date = new Date(`${dateValue}T00:00:00`);
    return date.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric"
    });
}

function formatDateTime(dateTimeValue) {
    const date = new Date(dateTimeValue);
    return date.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatFetchedAt(isoValue) {
    const date = new Date(isoValue);
    return date.toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
