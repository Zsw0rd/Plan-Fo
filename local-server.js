const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { getBookingRedirect, searchFlightOffers } = require("./lib/google-flights");

const ROOT_DIR = __dirname;
const PORT = Number(process.env.PORT || 3000);

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
};

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache"
    });
    response.end(JSON.stringify(payload));
}

function redirect(response, statusCode, location) {
    response.writeHead(statusCode, {
        "Location": location,
        "Cache-Control": "no-store, max-age=0"
    });
    response.end();
}

function resolveStaticPath(requestPath) {
    const decodedPath = decodeURIComponent(requestPath.split("?")[0]);
    let relativePath = decodedPath;

    if (relativePath === "/" || relativePath === "") {
        relativePath = "/index.html";
    }

    const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
    const absolutePath = path.join(ROOT_DIR, safePath);

    if (!absolutePath.startsWith(ROOT_DIR)) {
        return null;
    }

    return absolutePath;
}

function serveStaticFile(response, filePath) {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        sendJson(response, 404, { error: "File not found." });
        return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";

    response.writeHead(200, { "Content-Type": contentType });
    fs.createReadStream(filePath).pipe(response);
}

async function handleFlightSearch(request, response, query) {
    const origin = String(query.get("origin") || "").toUpperCase();
    const destination = String(query.get("destination") || "").toUpperCase();
    const departureDate = String(query.get("departureDate") || "");

    try {
        const payload = await searchFlightOffers({
            origin,
            destination,
            departureDate
        });

        sendJson(response, 200, payload);
    } catch (error) {
        sendJson(response, 502, {
            error: "Unable to fetch live flight offers from Google Flights.",
            details: error.message,
            hint: "Google may rate-limit requests. Wait a minute and try again, or use the Google Flights link on the page."
        });
    }
}

function parseSelectedLegs(value) {
    try {
        const parsed = JSON.parse(String(value || "[]"));
        return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
        return [];
    }
}

async function handleBookingRedirect(request, response, query) {
    const origin = String(query.get("origin") || "").toUpperCase();
    const destination = String(query.get("destination") || "").toUpperCase();
    const departureDate = String(query.get("departureDate") || "");
    const bookingToken = String(query.get("bookingToken") || "");
    const fallbackUrl = String(query.get("fallbackUrl") || "");
    const selectedLegs = parseSelectedLegs(query.get("selectedLegs"));

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

        sendJson(response, 404, { error: "No booking redirect was available for this flight." });
    } catch (error) {
        if (fallbackUrl.startsWith("https://www.google.com/travel/flights/")) {
            return redirect(response, 302, fallbackUrl);
        }

        sendJson(response, 502, {
            error: "Unable to open the selected booking option.",
            details: error.message
        });
    }
}

const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/api/flights") {
        if (request.method !== "GET") {
            return sendJson(response, 405, { error: "Method not allowed." });
        }

        return handleFlightSearch(request, response, requestUrl.searchParams);
    }

    if (requestUrl.pathname === "/api/book") {
        if (request.method !== "GET") {
            return sendJson(response, 405, { error: "Method not allowed." });
        }

        return handleBookingRedirect(request, response, requestUrl.searchParams);
    }

    const staticPath = resolveStaticPath(requestUrl.pathname);

    if (!staticPath) {
        return sendJson(response, 403, { error: "Forbidden." });
    }

    serveStaticFile(response, staticPath);
});

server.listen(PORT, () => {
    console.log(`Plane-Fo local server running at http://localhost:${PORT}`);
    console.log(`Open http://localhost:${PORT}/flights.html for live flight search.`);
    console.log("Live prices are scraped from Google Flights — no API account needed.");
}).on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Either:`);
        console.error(`  1. Open http://localhost:${PORT}/flights.html (server may already be running)`);
        console.error(`  2. Stop the other process, or run: $env:PORT=3001; node local-server.js`);
        process.exit(1);
    }

    throw error;
});
