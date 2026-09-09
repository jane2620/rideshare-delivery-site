
(function (global) {
    "use strict";

    // ── Platform detection ────────────────────────────────────────────────────

    /**
     * Identify the sending platform.
     *
     * @param {string} subject
     * @param {string} body
     * @param {string} [sender]  - "From" header value, e.g. "DoorDash <no-reply@doordash.com>"
     * Returns: "doordash" | "grubhub" | "instacart" | "unknown"
     */
    function detectPlatform(subject, body, sender) {
        const from = (sender || "").toLowerCase();
        if (from.includes("doordash.com"))   return "doordash";
        if (from.includes("grubhub.com"))    return "grubhub";
        if (from.includes("instacart.com"))  return "instacart";

        // Fallback: keyword scan of subject + body
        const hay = `${subject || ""} ${body || ""}`.toLowerCase();
        if (hay.includes("doordash"))  return "doordash";
        if (hay.includes("grubhub"))   return "grubhub";
        if (hay.includes("instacart")) return "instacart";
        return "unknown";
    }

    // ── Store extraction ──────────────────────────────────────────────────────

    function extractStore(subject, body, platform) {
        let m;

        // DoorDash subject: "Order Confirmation from <Store>"
        m = (subject || "").match(/Order Confirmation from (.+)/i);
        if (m) return m[1].trim();

        // Instacart subject: "Your <Store> order is confirmed …"
        m = (subject || "").match(/Your (.+?) order is confirmed/i);
        if (m) return m[1].trim();

        // Grubhub body: "delivery order from <Store> is being prepared"
        m = (body || "").match(/(?:delivery\s+)?order\s+from\s+(.+?)\s+is being prepared/i);
        if (m) return m[1].trim();

        // Grubhub subject: "Your <Store> order" (guard against "Your order")
        m = (subject || "").match(/Your\s+(.+?)\s+order\b/i);
        if (m && m[1].toLowerCase() !== "order") return m[1].trim();

        // Generic body: "order from <Store>" — capitalized merchant name
        m = (body || "").match(/order from\s+([A-Z][^.,\n]{2,40})/);
        if (m) return m[1].trim();

        return null;
    }

    // ── ETA extraction ────────────────────────────────────────────────────────

    /**
     * Normalize bare hour strings like "5pm" → "5:00 PM".
     * Leaves already-formatted times (e.g. "5:45pm") untouched except uppercasing AM/PM.
     */
    function normalizeTimeStr(t) {
        return t.trim()
            // "5pm" → "5:00 PM"
            .replace(/^(\d{1,2})(am|pm)$/i, (_, h, ap) => `${h}:00 ${ap.toUpperCase()}`)
            // "5:45pm" → "5:45 PM"
            .replace(/^(\d{1,2}:\d{2})(am|pm)$/i, (_, hm, ap) => `${hm} ${ap.toUpperCase()}`);
    }

    /**
     * Extract the ETA or scheduled delivery/pickup window from the email body.
     *
     * Handled patterns (in priority order):
     *   1. DoorDash: "estimated delivery time for your order is 10:27 AM - 10:37 AM"
     *   2. Grubhub:  "food should arrive between 5:45pm – 6:00pm"
     *   3. Generic "between X and Y" / "between X – Y"
     *   4. Instacart scheduled: "from 5pm - 8pm"
     *   5. Generic bare range:  "10:27 AM – 10:37 AM"
     *
     * Returns a normalized string like "5:00 PM - 8:00 PM", or null.
     */
    function extractETA(body) {
        if (!body) return null;
        let m;

        // 1. "estimated * time * is <HH:MM AM - HH:MM AM>"
        m = body.match(
            /estimated\s+\w+\s+time[^i]*?is\s+([\d:]+\s*[AP]M\s*[-–]\s*[\d:]+\s*[AP]M)/i
        );
        if (m) return m[1].replace(/\s+/g, " ").trim();

        // 2. "arrive between Xpm – Ypm"  (Grubhub; accepts colon or no colon)
        m = body.match(
            /arrive\s+between\s+([\d]{1,2}(?::[\d]{2})?[ap]m)\s*[-–]\s*([\d]{1,2}(?::[\d]{2})?[ap]m)/i
        );
        if (m) return `${normalizeTimeStr(m[1])} - ${normalizeTimeStr(m[2])}`;

        // 3. "between X and Y" / "between X – Y"
        m = body.match(
            /between\s+([\d]{1,2}(?::[\d]{2})?[ap]m)\s+(?:and|[-–])\s+([\d]{1,2}(?::[\d]{2})?[ap]m)/i
        );
        if (m) return `${normalizeTimeStr(m[1])} - ${normalizeTimeStr(m[2])}`;

        // 4. Instacart: "from 5pm - 8pm" or "from 5pm – 8pm"
        m = body.match(
            /from\s+([\d]{1,2}(?::[\d]{2})?[ap]m)\s*[-–]\s*([\d]{1,2}(?::[\d]{2})?[ap]m)/i
        );
        if (m) return `${normalizeTimeStr(m[1])} - ${normalizeTimeStr(m[2])}`;

        // 5. Generic bare range with colons: "10:27 AM – 10:37 AM"
        m = body.match(/([\d]{1,2}:[\d]{2}\s*[AP]M\s*[-–]\s*[\d]{1,2}:[\d]{2}\s*[AP]M)/i);
        if (m) return m[1].replace(/\s+/g, " ").trim();

        return null;
    }

    // ── Scheduled date (Instacart and similar) ────────────────────────────────

    /**
     * For platforms like Instacart where the delivery is scheduled in advance,
     * extract the scheduled delivery date (distinct from the email sent date).
     *
     * Examples:
     *   body:    "Oct 22 from 5pm - 8pm"  → "Oct 22"
     *   subject: "confirmed for October 22" → "October 22"
     *
     * Returns a short date string or null.
     */
    function extractScheduledDate(body, subject) {
        // Body: "Oct 22" or "October 22"
        let m = (body || "").match(
            /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b/i
        );
        if (m) return m[0];

        // Subject: "confirmed for October 22, 2024" etc.
        m = (subject || "").match(
            /(?:confirmed for|scheduled for|arriving)\s+([A-Za-z]+ \d{1,2}(?:,?\s*\d{4})?)/i
        );
        if (m) return m[1].trim();

        return null;
    }

    // ── Order type ────────────────────────────────────────────────────────────

    /**
     * Infer whether this is a delivery or pickup order.
     * Returns: "pickup" | "delivery" | "unknown"
     */
    function extractOrderType(body, subject) {
        const hay = `${subject || ""} ${body || ""}`;
        if (/pick.?up|go straight to the restaurant|pick it up|ready for pickup/i.test(hay))
            return "pickup";
        if (/deliver|on its way|driver|shopper|track your order/i.test(hay))
            return "delivery";
        return "unknown";
    }

    // ── Total extraction ──────────────────────────────────────────────────────

    /**
     * Extract the final charged total (not subtotals, tax, or tips).
     *
     * Priority:
     *   1. "Total charge $X"    — Grubhub breakdown label (most specific)
     *   2. "Total: $X"          — DoorDash / Grubhub header
     *   3. "Estimated Total $X" — DoorDash receipt block
     *
     * Returns "$X.XX" or null.
     */
    function extractTotal(body) {
        if (!body) return null;
        let m;

        m = body.match(/Total\s+charge\s*\$?([\d,]+\.\d{2})/i);
        if (m) return `$${m[1]}`;

        m = body.match(/\bTotal:\s*\$?([\d,]+\.\d{2})/i);
        if (m) return `$${m[1]}`;

        m = body.match(/Estimated Total\s+\$?([\d,]+\.\d{2})/i);
        if (m) return `$${m[1]}`;

        return null;
    }

    // ── Date normalization ────────────────────────────────────────────────────

    function normalizeDate(dateStr) {
        if (!dateStr || dateStr === "unknown") return null;
        try {
            return new Date(dateStr).toISOString();
        } catch {
            return dateStr;
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Summarize a single parsed receipt object into a PII-free record.
     *
     * Input (from eml_deanon / processEmailReceiptsZipForPreview):
     *   { receipt_index, subject, date, body, sender? }
     *
     *   `sender` = raw From header, e.g. "DoorDash <no-reply@doordash.com>".
     *   Used as primary platform signal; body keywords are the fallback.
     *   The sender value itself is NOT included in output.
     *
     * Output:
     *   {
     *     receipt_index,
     *     sent_at,          // ISO timestamp — when the email was sent
     *     platform,         // "doordash" | "grubhub" | "instacart" | "unknown"
     *     store,            // merchant name, e.g. "Costco", "Chipotle"
     *     order_type,       // "delivery" | "pickup" | "unknown"
     *     scheduled_date,   // "Oct 22" for advance orders (Instacart), else null
     *     eta_window,       // "5:00 PM - 8:00 PM" or null
     *     total,            // "$18.71" or null
     *   }
     */
    function summarizeReceipt(receipt) {
        const body     = receipt.body   || "";
        const subject  = receipt.subject || "";
        const sender   = receipt.sender  || receipt.from || "";
        const platform = detectPlatform(subject, body, sender);

        return {
            receipt_index:  receipt.receipt_index,
            sent_at:        normalizeDate(receipt.date),
            platform,
            store:          extractStore(subject, body, platform),
            order_type:     extractOrderType(body, subject),
            scheduled_date: extractScheduledDate(body, subject),
            eta_window:     extractETA(body),
            total:          extractTotal(body),
        };
    }

    /**
     * Summarize a full receipts payload (output of the eml_deanon pipeline).
     * Shape matches Cloudflare email_worker.js forward payload (PII-free receipts only).
     *
     * Input:  { prolific_id, processed_at, receipts: [...raw] }
     * @param {object} [options]
     * @param {string} [options.original_subject]  Forward subject line; defaults to prolific_id (zip upload has no outer email).
     *
     * Output: { prolific_id, original_subject, processed_at, receipt_count, receipts: [...] }
     */
    function summarizeAll(payload, options) {
        options = options || {};
        const prolific_id = payload.prolific_id || null;
        const original_subject =
            options.original_subject != null && String(options.original_subject).length
                ? String(options.original_subject)
                : prolific_id || null;

        const receipts = (payload.receipts || []).map(summarizeReceipt);

        return {
            prolific_id,
            original_subject,
            processed_at:  payload.processed_at || new Date().toISOString(),
            receipt_count: receipts.length,
            receipts,
        };
    }

    // ── Exports ───────────────────────────────────────────────────────────────

    const api = {
        detectPlatform,
        extractStore,
        extractETA,
        extractScheduledDate,
        extractOrderType,
        extractTotal,
        summarizeReceipt,
        summarizeAll,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;           // Node.js
    } else {
        global.receiptExtractor = api;  // Browser
    }

})(typeof window !== "undefined" ? window : globalThis);