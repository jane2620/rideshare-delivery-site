// Lives in strip-email-pii; reference here 

import PostalMime from "postal-mime";
import { createMimeMessage } from "mimetext";
import { EmailMessage } from "cloudflare:email";

// configuration
const RECIPIENT = "rideshare.delivery.study@gmail.com";
const SENDER    = "receipts@delivery-study.com";

export default {
    async email(message, env, ctx) {
        const parser     = new PostalMime();
        const outerEmail = await parser.parse(message.raw);

        const subject    = outerEmail.subject || "No Subject";
        const prolificId = extractProlificId(subject);

        console.log(`[DEBUG] Processing: "${subject}" | Prolific ID: ${prolificId}`);

        const attachments  = outerEmail.attachments || [];
        const receiptParts = attachments.filter(
            att => att.mimeType === "message/rfc822" || (att.filename || "").endsWith(".eml")
        );

        const receipts = [];

        if (receiptParts.length > 0) {
            console.log(`[DEBUG] Found ${receiptParts.length} attachment(s). Processing...`);
            for (let i = 0; i < receiptParts.length; i++) {
                const innerParser = new PostalMime();
                const innerEmail  = await innerParser.parse(receiptParts[i].content);
                receipts.push(summarizeReceipt(innerEmail, i));
            }
        } else {
            console.log("[DEBUG] No attachments — processing outer message as receipt.");
            receipts.push(summarizeReceipt(outerEmail, 0));
        }

        // Re-index sequentially
        receipts.forEach((r, i) => { r.receipt_index = i + 1; });

        const output = {
            prolific_id:   prolificId || "NOT FOUND",
            original_subject: subject,
            processed_at:  new Date().toISOString(),
            receipt_count: receipts.length,
            receipts,
        };

        await forwardResults(output, prolificId, env);
    },
};

// forward results to the study inbox
async function forwardResults(output, prolificId, env) {
    const jsonString = JSON.stringify(output, null, 2);
    const label      = prolificId || "unknown";

    const msg = createMimeMessage();
    msg.setSender({ name: "Receipt Processor", addr: SENDER });
    msg.setRecipient(RECIPIENT);
    msg.setSubject(`[DELIVERY DATA] ${label}`);
    msg.addMessage({
        contentType: "text/plain",
        data: `Processed ${output.receipt_count} receipt(s). JSON attached.`,
    });
    msg.addAttachment({
        filename:    `receipts_${label}.json`,
        contentType: "application/json",
        data:        jsonString,
    });

    const outMessage = new EmailMessage(SENDER, RECIPIENT, msg.asRaw());
    try {
        await env.MY_EMAIL.send(outMessage);
        console.log(`[DEBUG] Response sent to ${RECIPIENT}`);
    } catch (e) {
        console.error(`[DEBUG] Error sending email: ${e.message}`);
    }
}

//  * Output:
//  *   {
//  *     receipt_index,
//  *     sent_at_utc,      // UTC ISO string
//  *     sent_at_local,    // ISO-like string using the recipient-local offset
//  *     timezone,         // fixed-offset zone, e.g. "UTC-04:00"
//  *     utc_offset,       // e.g. "-04:00"
//  *     platform,         // "doordash" | "grubhub" | "instacart" | "unknown"
//  *     email_type,       // "confirmation" | "receipt" | "cancellation" | "unknown"
//  *     store,            // merchant name
//  *     is_pickup,        // boolean
//  *     is_delivery,      // boolean
//  *     is_scheduled,     // boolean
//  *     delivery_date,    // "Oct 22" for advance orders, else null
//  *     delivery_time_local, // actual delivery time from an Instacart receipt
//  *     eta_window,       // "5:00 PM - 8:00 PM" or null
//  *     order_date,       // placement date from an Instacart receipt
//  *     total,            // "$18.71" or null
//  *   }

function summarizeReceipt(emailObj, index) {
    const subject = emailObj.subject || "";
    const sender  = senderAddress(emailObj);   // e.g. "no-reply@doordash.com"
    const body    = extractSearchableBody(emailObj);
    const platform = detectPlatform(sender, subject, body);
    const grubhubDelivery = platform === "grubhub"
        ? extractGrubhubDelivery(emailObj.html)
        : null;
    const instacart = platform === "instacart"
        ? extractInstacartDetails(subject, body)
        : null;
    const sentTimes = extractSentTimes(emailObj, grubhubDelivery?.timezoneOffset);
    const emailType = instacart?.emailType || detectEmailType(subject);

    if (emailType === "cancellation") {
        return {
            receipt_index: index + 1,
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
        receipt_index:  index + 1,
        ...sentTimes,
        platform,
        email_type:     emailType,
        store:          instacart?.store || extractStore(subject, body),
        ...orderFlags,
        order_date:     instacart?.orderDate || null,
        delivery_date:  instacart?.deliveryDate || extractDeliveryDate(body, subject),
        delivery_time_local: instacart?.deliveryTimeLocal || null,
        eta_window:     grubhubDelivery?.etaWindow || instacart?.etaWindow || extractETA(body),
        total:          extractTotal(body),
    };
}

function detectEmailType(subject) {
    if (/cancel(?:ed|led|lation)/i.test(subject)) return "cancellation";
    if (/receipt/i.test(subject)) return "receipt";
    if (/confirm(?:ed|ation)/i.test(subject)) return "confirmation";
    return "unknown";
}

function extractInstacartDetails(subject, body) {
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

function normalizeWrittenDate(value) {
    return value
        .replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1")
        .replace(/\s+/g, " ")
        .trim();
}

// keep date header as UTC send time (doesn't provide local timezone)
// populate local time for grubhub only 
function extractSentTimes(emailObj, recipientOffset = null) {
    const rawDate = emailObj.headers?.find(
        header => (header.key || "").toLowerCase() === "date"
    )?.value || "";
    const date = new Date(emailObj.date || rawDate);

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

function offsetStringToMinutes(offset) {
    if (offset === "Z") return 0;

    const match = offset.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!match) return null;

    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === "-" ? -minutes : minutes;
}

// grubhub hands us a lot in email schema in JSON-LD format 
// can parse ETA window and timezone offset 
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
        } catch {
            // if malformed, ignore and use string matching
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


/**
 * Instacart's most reliable order wording is often present only in HTML.
 * Search both MIME representations when available; no body text is emitted.
 */
function extractSearchableBody(emailObj) {
    const text = emailObj.text?.trim() || "";
    const html = emailObj.html ? htmlToPlainText(emailObj.html) : "";

    if (text && html) return `${text}\n${html}`;
    return text || html;
}

/**
 * Strip HTML to readable plain text.
 * Inserts newlines at block-level boundaries before removing tags.
 */
function htmlToPlainText(html) {
    return html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<\/(div|tr|p|h[1-6])>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#8211;/g, "-")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

/**
 * Extract the sender's email address from PostalMime's `from` field.
 * PostalMime returns `from` as { name, address } or an array.
 */
function senderAddress(emailObj) {
    const from = emailObj.from;
    if (!from) return "";
    if (typeof from === "string") return from.toLowerCase();
    if (Array.isArray(from)) return (from[0]?.address || "").toLowerCase();
    return (from.address || "").toLowerCase();
}

function detectPlatform(sender, subject, body) {
    if (sender.includes("doordash.com"))  return "doordash";
    if (sender.includes("grubhub.com"))   return "grubhub";
    if (sender.includes("instacart.com")) return "instacart";

    const hay = `${subject} ${body}`.toLowerCase();
    if (hay.includes("doordash"))  return "doordash";
    if (hay.includes("grubhub"))   return "grubhub";
    if (hay.includes("instacart")) return "instacart";
    return "unknown";
}

// Attempt to get merchant name from subject/body
function extractStore(subject, body) {
    let m;

    // Search subject first, then body -- capture what's AFTER "from"
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

// extract ETA
// Normalize  hour strings: "5pm" → "5:00 PM", "5:45pm" → "5:45 PM"
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

// try to grab delivery date if listed (e.g., Instacart)
function extractDeliveryDate(body, subject) {
    let m = body.match(
        /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}\b/i
    );
    if (m) return m[0];

    m = subject.match(/(?:confirmed for|scheduled for|arriving)\s+([A-Za-z]+ \d{1,2}(?:,?\s*\d{4})?)/i);
    if (m) return m[1].trim();

    return null;
}

// Look for order type — returns three boolean flags
function extractOrderType(body, subject) {
    const hay = `${subject} ${body}`;
    return {
        is_pickup:    /pick.?up|go straight to the restaurant|pick it up|ready for pickup/i.test(hay),
        is_delivery:  /deliver|on its way|driver|shopper|track your order/i.test(hay),
        is_scheduled: /scheduled|advance order|future order|scheduled delivery/i.test(hay),
    };
}

// attempt to extract total price 
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

// grab prolific id from email subject
function extractProlificId(subject) {
    const cleaned = subject.replace(/^(Re|Fwd|Fw|\[DELIVERY DATA\]):\s*/i, "").trim();
    const m = cleaned.match(/^([A-Za-z0-9]+)/);
    return m ? m[1] : null;
}