(function (global) {
    "use strict";

    // ── Platform detection ────────────────────────────────────────────────────

    function detectPlatform(sender, subject, body) {
        const from = (sender || "").toLowerCase();
        if (from.includes("doordash.com"))   return "doordash";
        if (from.includes("grubhub.com"))    return "grubhub";
        if (from.includes("instacart.com"))  return "instacart";

        const hay = `${subject || ""} ${body || ""}`.toLowerCase();
        if (hay.includes("doordash"))  return "doordash";
        if (hay.includes("grubhub"))   return "grubhub";
        if (hay.includes("instacart")) return "instacart";
        return "unknown";
    }

    // ── Email type detection ──────────────────────────────────────────────────

    function detectEmailType(subject) {
        if (/cancel(?:ed|led|lation)/i.test(subject)) return "cancellation";
        if (/receipt/i.test(subject)) return "receipt";
        if (/confirm(?:ed|ation)/i.test(subject)) return "confirmation";
        return "unknown";
    }

    // ── Store extraction ──────────────────────────────────────────────────────

    function extractStore(subject, body) {
        subject = subject || "";
        body = body || "";
        let m;

        const orderConfirmRe = /Order Confirmation(?:\s+for\s+[^,\n]+?)?\s+from\s+(.+)/i;
        m = subject.match(orderConfirmRe) || body.match(orderConfirmRe);
        if (m) return m[1].trim();

        m = subject.match(/Your (.+?) order is confirmed/i);
        if (m) return m[1].trim();

        m = body.match(/(?:delivery\s+)?order\s+from\s+(.+?)\s+is being prepared/i);
        if (m) return m[1].trim();

        m = subject.match(/Your\s+(.+?)\s+order\b/i);
        if (m && m[1].toLowerCase() !== "order") return m[1].trim();

        m = body.match(/order from\s+([A-Z][^.,\n]{2,40})/);
        if (m) return m[1].trim();

        return null;
    }

    // ── Instacart-specific parsing ────────────────────────────────────────────

    function normalizeWrittenDate(value) {
        return value
            .replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1")
            .replace(/\s+/g, " ")
            .trim();
    }

    function extractInstacartDetails(subject, body) {
        subject = subject || "";
        body = body || "";

        if (/cancel(?:ed|led|lation)/i.test(subject)) {
            return { emailType: "cancellation" };
        }

        const confirmationSubject = subject.match(
            /Your\s+(.+?)\s+order\s+is\s+confirmed\s+for\s+(.+?)\s*$/i
        );
        if (confirmationSubject) {
            const scheduled = body.match(
                /It['’]s\s+scheduled\s+for\s+delivery\s+(Today|Tomorrow|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)\s+from\s+(\d{1,2}(?::\d{2})?\s*[ap]m)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*[ap]m)/i
            );

            return {
                emailType: "confirmation",
                store: confirmationSubject[1].trim(),
                deliveryDate: normalizeWrittenDate(scheduled?.[1] || confirmationSubject[2]),
                etaWindow: scheduled
                    ? `${normalizeTimeStr(scheduled[2])} - ${normalizeTimeStr(scheduled[3])}`
                    : null,
                orderDate: null,
                deliveryTimeLocal: null,
            };
        }

        if (/Your\s+Instacart\s+order\s+receipt/i.test(subject)) {
            const receipt = body.match(
                /Your\s+order\s+from\s+(.+?)\s+was\s+placed\s+on\s+((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\s+and\s+delivered\s+on\s+((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})\s+at\s+(\d{1,2}(?::\d{2})?\s*[ap]m)/i
            );

            return {
                emailType: "receipt",
                store: receipt?.[1]?.trim() || null,
                orderDate: receipt ? normalizeWrittenDate(receipt[2]) : null,
                deliveryDate: receipt ? normalizeWrittenDate(receipt[3]) : null,
                deliveryTimeLocal: receipt ? normalizeTimeStr(receipt[4]) : null,
                etaWindow: null,
            };
        }

        return { emailType: detectEmailType(subject) };
    }

    // ── ETA / time helpers ────────────────────────────────────────────────────

    function normalizeTimeStr(t) {
        return t.trim()
            .replace(/^(\d{1,2})(am|pm)$/i,       (_, h, ap)  => `${h}:00 ${ap.toUpperCase()}`)
            .replace(/^(\d{1,2}:\d{2})(am|pm)$/i, (_, hm, ap) => `${hm} ${ap.toUpperCase()}`);
    }

    function extractETA(body) {
        if (!body) return null;
        let m;

        m = body.match(/estimated\s+\w+\s+time[^i]*?is\s+([\d:]+\s*[AP]M\s*[-–]\s*[\d:]+\s*[AP]M)/i);
        if (m) return m[1].replace(/\s+/g, " ").trim();

        m = body.match(/arrive\s+between\s+([\d]{1,2}(?::[\d]{2})?[ap]m)\s*[-–]\s*([\d]{1,2}(?::[\d]{2})?[ap]m)/i);
        if (m) return `${normalizeTimeStr(m[1])} - ${normalizeTimeStr(m[2])}`;

        m = body.match(/between\s+([\d]{1,2}(?::[\d]{2})?[ap]m)\s+(?:and|[-–])\s+([\d]{1,2}(?::[\d]{2})?[ap]m)/i);
        if (m) return `${normalizeTimeStr(m[1])} - ${normalizeTimeStr(m[2])}`;

        m = body.match(/from\s+([\d]{1,2}(?::[\d]{2})?[ap]m)\s*[-–]\s*([\d]{1,2}(?::[\d]{2})?[ap]m)/i);
        if (m) return `${normalizeTimeStr(m[1])} - ${normalizeTimeStr(m[2])}`;

        m = body.match(/([\d]{1,2}:[\d]{2}(?:\s*[AP]M)?)\s*[-–]\s*([\d]{1,2}:[\d]{2}(?:\s*[AP]M)?)/i);
        if (m) return `${m[1].replace(/\s+/g, " ").trim()} - ${m[2].replace(/\s+/g, " ").trim()}`;

        return null;
    }

    function extractDeliveryDate(body, subject) {
        let m = (body || "").match(
            /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b/i
        );
        if (m) return m[0];

        m = (subject || "").match(/(?:confirmed for|scheduled for|arriving)\s+([A-Za-z]+ \d{1,2}(?:,?\s*\d{4})?)/i);
        if (m) return m[1].trim();

        return null;
    }

    // ── Order type flags ──────────────────────────────────────────────────────

    function extractOrderType(body, subject) {
        const hay = `${subject || ""} ${body || ""}`;
        return {
            is_pickup:    /pick.?up|go straight to the restaurant|pick it up|ready for pickup/i.test(hay),
            is_delivery:  /deliver|on its way|driver|shopper|track your order/i.test(hay),
            is_scheduled: /scheduled|advance order|future order|scheduled delivery/i.test(hay),
        };
    }

    // ── Total extraction ──────────────────────────────────────────────────────

    function extractTotal(body) {
        if (!body) return null;
        let m;

        m = body.match(/Total\s+charge\s*\$?([\d,]+\.\d{2})/i);
        if (m) return `$${m[1]}`;

        m = body.match(/(?:^|\n)\s*Total:?\s*\$?([\d,]+\.\d{2})/im);
        if (m) return `$${m[1]}`;

        m = body.match(/Estimated Total\s+\$?([\d,]+\.\d{2})/i);
        if (m) return `$${m[1]}`;

        return null;
    }

    // ── Grubhub JSON-LD delivery window ───────────────────────────────────────
    // Needs raw HTML. The browser pipeline (eml_deanon_browser.js) flattens the
    // body to plain text before handing it here, so this resolves to null in
    // that path and eta_window falls back to the regex-based extractETA below.

    function extractGrubhubDelivery(html) {
        if (!html) return null;

        const scripts = html.matchAll(
            /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
        );

        for (const script of scripts) {
            try {
                const json = JSON.parse(script[1].trim());
                const delivery = findJsonLdType(json, "ParcelDelivery");
                if (!delivery) continue;

                const from = delivery.expectedArrivalFrom;
                const until = delivery.expectedArrivalUntil;
                if (typeof from !== "string" || typeof until !== "string") continue;

                const fromOffset = extractTimeOffset(from);
                const untilOffset = extractTimeOffset(until);

                return {
                    etaWindow: `${from} - ${until}`,
                    timezoneOffset: fromOffset || untilOffset,
                };
            } catch (e) {
                // malformed JSON-LD — fall through to string matching
            }
        }

        return null;
    }

    function findJsonLdType(value, type) {
        if (Array.isArray(value)) {
            for (const item of value) {
                const match = findJsonLdType(item, type);
                if (match) return match;
            }
            return null;
        }

        if (!value || typeof value !== "object") return null;

        const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
        if (types.includes(type)) return value;

        for (const child of Object.values(value)) {
            const match = findJsonLdType(child, type);
            if (match) return match;
        }
        return null;
    }

    function extractTimeOffset(value) {
        const match = value.match(/(Z|[+-]\d{2}:\d{2})$/i);
        if (!match) return null;
        return match[1].toUpperCase() === "Z" ? "+00:00" : match[1];
    }

    // ── Sent-time normalization ───────────────────────────────────────────────

    function offsetStringToMinutes(offset) {
        if (offset === "Z") return 0;

        const match = offset.match(/^([+-])(\d{2}):?(\d{2})$/);
        if (!match) return null;

        const minutes = Number(match[2]) * 60 + Number(match[3]);
        return match[1] === "-" ? -minutes : minutes;
    }

    /**
     * @param {string} rawDate            - Date header string (already extracted upstream)
     * @param {string} [recipientOffset]  - fixed-offset string from grubhub JSON-LD, if any
     */
    function extractSentTimes(rawDate, recipientOffset) {
        const date = new Date(rawDate || "");

        if (Number.isNaN(date.getTime())) {
            return {
                sent_at_utc: null,
                sent_at_local: null,
                timezone: null,
                utc_offset: null,
            };
        }

        const offsetMinutes = recipientOffset
            ? offsetStringToMinutes(recipientOffset)
            : null;
        if (offsetMinutes === null) {
            return {
                sent_at_utc: date.toISOString(),
                sent_at_local: null,
                timezone: null,
                utc_offset: null,
            };
        }

        const sign = offsetMinutes < 0 ? "-" : "+";
        const absoluteOffset = Math.abs(offsetMinutes);
        const offset = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, "0")}:${String(absoluteOffset % 60).padStart(2, "0")}`;
        const local = new Date(date.getTime() + offsetMinutes * 60_000);
        const localDateTime = [
            local.getUTCFullYear(),
            String(local.getUTCMonth() + 1).padStart(2, "0"),
            String(local.getUTCDate()).padStart(2, "0"),
        ].join("-") + "T" + [
            String(local.getUTCHours()).padStart(2, "0"),
            String(local.getUTCMinutes()).padStart(2, "0"),
            String(local.getUTCSeconds()).padStart(2, "0"),
        ].join(":") + offset;

        return {
            sent_at_utc: date.toISOString(),
            sent_at_local: localDateTime,
            timezone: `UTC${offset}`,
            utc_offset: offset,
        };
    }

    // ── Sender parsing ────────────────────────────────────────────────────────

    /**
     * Extract the email address from a raw "From" header string,
     * e.g. 'DoorDash <no-reply@doordash.com>' → 'no-reply@doordash.com'.
     */
    function senderAddress(sender) {
        if (!sender) return "";
        const m = sender.match(/<([^>]+)>/);
        return (m ? m[1] : sender).trim().toLowerCase();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Summarize a single parsed receipt object into a PII-free record.
     *
     * Input (from eml_deanon / processEmailReceiptsZipForPreview):
     *   { receipt_index, subject, date, sender, body }
     *
     *   `sender` is the raw From header, e.g. "DoorDash <no-reply@doordash.com>".
     *   Used as the primary platform signal; body keywords are the fallback.
     *   The sender value itself is NOT included in output.
     *
     * Output:
     *   {
     *     receipt_index,
     *     sent_at_utc, sent_at_local, timezone, utc_offset,
     *     platform, email_type, store,
     *     is_pickup, is_delivery, is_scheduled,
     *     order_date, delivery_date, delivery_time_local, eta_window, total,
     *   }
     */
    function summarizeReceipt(receipt) {
        const subject = receipt.subject || "";
        const sender  = senderAddress(receipt.sender);
        const body    = receipt.body || "";
        const platform = detectPlatform(sender, subject, body);

        const grubhubDelivery = platform === "grubhub"
            ? extractGrubhubDelivery(receipt.html)
            : null;
        const instacart = platform === "instacart"
            ? extractInstacartDetails(subject, body)
            : null;
        const sentTimes = extractSentTimes(receipt.date, grubhubDelivery?.timezoneOffset);
        const emailType = instacart?.emailType || detectEmailType(subject);

        if (emailType === "cancellation") {
            return {
                receipt_index: receipt.receipt_index,
                ...sentTimes,
                platform,
                email_type: "cancellation",
                store: null,
                is_pickup: false,
                is_delivery: false,
                is_scheduled: false,
                order_date: null,
                delivery_date: null,
                delivery_time_local: null,
                eta_window: null,
                total: null,
            };
        }

        const orderFlags = extractOrderType(body, subject);
        if (instacart?.emailType === "confirmation") {
            orderFlags.is_delivery = true;
            orderFlags.is_scheduled = true;
        }

        return {
            receipt_index: receipt.receipt_index,
            ...sentTimes,
            platform,
            email_type: emailType,
            store: instacart?.store || extractStore(subject, body),
            ...orderFlags,
            order_date: instacart?.orderDate || null,
            delivery_date: instacart?.deliveryDate || extractDeliveryDate(body, subject),
            delivery_time_local: instacart?.deliveryTimeLocal || null,
            eta_window: grubhubDelivery?.etaWindow || instacart?.etaWindow || extractETA(body),
            total: extractTotal(body),
        };
    }

    /**
     * Summarize a full receipts payload (output of the eml_deanon pipeline).
     * Shape matches the Cloudflare email worker's forward payload (PII-free receipts only).
     *
     * Input:  { prolific_id, processed_at, receipts: [...raw] }
     * @param {object} [options]
     * @param {string} [options.original_subject]  Forward subject line; defaults to prolific_id.
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
        detectEmailType,
        extractStore,
        extractETA,
        extractDeliveryDate,
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
