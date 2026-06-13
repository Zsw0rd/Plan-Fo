const { getBookingRedirect } = require("../lib/google-flights");

function redirect(response, statusCode, location) {
    response.statusCode = statusCode;
    response.setHeader("Location", location);
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.end();
}

function sendJson(response, statusCode, payload) {
    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store, max-age=0");
    response.setHeader("Pragma", "no-cache");
    response.end(JSON.stringify(payload));
}

function parseSelectedLegs(value) {
    try {
        const parsed = JSON.parse(String(value || "[]"));
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

module.exports = async function handler(request, response) {
    if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        return sendJson(response, 405, { error: "Method not allowed." });
    }

    const origin = String(request.query?.origin || "").toUpperCase();
    const destination = String(request.query?.destination || "").toUpperCase();
    const departureDate = String(request.query?.departureDate || "");
    const bookingToken = String(request.query?.bookingToken || "");
    const fallbackUrl = String(request.query?.fallbackUrl || "");
    const selectedLegs = parseSelectedLegs(request.query?.selectedLegs);

    try {
        const bookingUrl = await getBookingRedirect({
            bookingToken,
            origin,
            destination,
            departureDate,
            selectedLegs
        });

        if (bookingUrl) {
            return redirect(response, 302, bookingUrl);
        }

        if (fallbackUrl.startsWith("https://www.google.com/travel/flights/")) {
            return redirect(response, 302, fallbackUrl);
        }

        return sendJson(response, 404, { error: "No booking redirect was available for this flight." });
    } catch (error) {
        if (fallbackUrl.startsWith("https://www.google.com/travel/flights/")) {
            return redirect(response, 302, fallbackUrl);
        }

        return sendJson(response, 502, {
            error: "Unable to open the selected booking option.",
            details: error.message
        });
    }
};
