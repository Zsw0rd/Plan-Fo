const { searchFlightOffers } = require("../lib/google-flights");

function sendJson(response, statusCode, payload) {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(JSON.stringify(payload));
}

module.exports = async function handler(request, response) {
    if (request.method === "OPTIONS") {
        response.setHeader("Allow", "GET, OPTIONS");
        response.statusCode = 204;
        response.end();
        return;
    }

    if (request.method !== "GET") {
        response.setHeader("Allow", "GET, OPTIONS");
        return sendJson(response, 405, { error: "Method not allowed." });
    }

    const origin = String(request.query?.origin || "").toUpperCase();
    const destination = String(request.query?.destination || "").toUpperCase();
    const departureDate = String(request.query?.departureDate || "");

    try {
        const payload = await searchFlightOffers({
            origin,
            destination,
            departureDate
        });

        return sendJson(response, 200, payload);
    } catch (error) {
        return sendJson(response, 502, {
            error: "Unable to fetch live flight offers from Google Flights.",
            details: error.message,
            hint: "Google may rate-limit requests from serverless hosts. Wait a minute and try again, or use the Google Flights link on the page."
        });
    }
};
