(function (global) {
    "use strict";

    // ── MIME decoding ─────────────────────────────────────────────────────────

    /**
     * Decode a quoted-printable encoded string.
     * Handles soft line breaks (=\n), hex sequences (=XX), and bare CR.
     */
    function decodeQuotedPrintable(str) {
        // Collapse soft line breaks first
        str = str.replace(/=\r?\n/g, "");
        try {
            const bytes = [];
            let i = 0;
            while (i < str.length) {
                if (str[i] === "=" && i + 2 < str.length) {
                    bytes.push(parseInt(str.substring(i + 1, i + 3), 16));
                    i += 3;
                } else if (str[i] === "\r") {
                    i++;
                } else {
                    bytes.push(str.charCodeAt(i));
                    i++;
                }
            }
            return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
        } catch (e) {
            console.warn("QP decode error:", e);
            return str;
        }
    }

    /**
     * Decode a base64 string to a UTF-8 string.
     */
    function base64DecodeToString(b64) {
        const clean = b64.replace(/\s/g, "");
        const binary = atob(clean);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return new TextDecoder("utf-8").decode(bytes);
    }

    /**
     * Triple base64 decode — required for nested RFC822 parts exported from
     * Gmail via Google Apps Script, which double-encodes the content.
     */
    function tripleBase64Decode(content) {
        let c = content.replace(/\s/g, "");
        for (let t = 0; t < 3; t++) {
            c = base64DecodeToString(c);
        }
        return c;
    }

    // ── HTML → plain text ─────────────────────────────────────────────────────

    /**
     * Strip HTML markup and normalize whitespace, producing readable plain text.
     * Removes <style> and <script> blocks entirely before stripping tags.
     */
    function htmlToPlainText(html) {
        return html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/[ \t]{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }

    // ── Header parsing ────────────────────────────────────────────────────────

    /**
     * Extract a single header value from a raw RFC822 header block.
     * Handles folded headers (continuation lines starting with whitespace).
     *
     * @param {string} headers  - The header section of the message
     * @param {string} name     - Header name, e.g. "Subject"
     * @returns {string|null}
     */
    function extractHeader(headers, name) {
        const pattern = new RegExp(`^${name}:\\s*(.+(?:\\n[ \\t].+)*)`, "im");
        const m = headers.match(pattern);
        if (!m) return null;
        // Unfold: collapse continuation whitespace
        return m[1].replace(/\n[ \t]+/g, " ").trim();
    }

    // ── Single message parser ─────────────────────────────────────────────────

    /**
     * Parse one decoded RFC822 message string into a receipt object.
     * Handles both quoted-printable and plain text bodies.
     * If the body contains HTML it is converted to plain text.
     *
     * @param {string} raw    - Full RFC822 message text (headers + body)
     * @param {number} index  - Zero-based index (receipt_index will be index + 1)
     * @returns {{ receipt_index, subject, date, sender, body }}
     */
    function parseMessage(raw, index) {
        const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        // Split headers from body at the first blank line
        const blankLine = normalized.indexOf("\n\n");
        const headerSection = blankLine !== -1 ? normalized.substring(0, blankLine) : normalized;
        const rawBody       = blankLine !== -1 ? normalized.substring(blankLine + 2) : "";

        const subject = extractHeader(headerSection, "Subject") || "unknown";
        const date    = extractHeader(headerSection, "Date")    || "unknown";
        const sender  = extractHeader(headerSection, "From")    || "";

        // Determine body encoding
        const encoding = (extractHeader(headerSection, "Content-Transfer-Encoding") || "").toLowerCase();
        const contentType = (extractHeader(headerSection, "Content-Type") || "").toLowerCase();

        let body = "";

        if (encoding === "quoted-printable") {
            // QP may appear at the top level (standalone .eml) or inside a MIME part
            body = decodeQuotedPrintable(rawBody);
        } else if (encoding === "base64") {
            try {
                body = base64DecodeToString(rawBody);
            } catch (e) {
                console.warn("Base64 body decode failed:", e);
                body = rawBody;
            }
        } else {
            // Try to find a quoted-printable sub-part (common in multipart messages
            // that weren't split at the boundary level)
            const qpMatch = normalized.match(
                /Content-Transfer-Encoding:\s*quoted-printable[\s\S]*?\n\n([\s\S]*?)(?=\n--[^\n]|$)/i
            );
            if (qpMatch) {
                body = decodeQuotedPrintable(qpMatch[1]);
            } else {
                body = rawBody;
            }
        }

        // Convert HTML to plain text if needed
        if (body.includes("<") && (contentType.includes("html") || /<html|<body|<table|<td/i.test(body))) {
            body = htmlToPlainText(body);
        } else if (body.includes("<")) {
            // Ambiguous — strip tags anyway if they appear substantial
            const tagCount = (body.match(/<[^>]+>/g) || []).length;
            if (tagCount > 5) body = htmlToPlainText(body);
        }

        body = body.replace(/\n{3,}/g, "\n\n").trim();

        return {
            receipt_index: index + 1,
            subject,
            date,
            sender,
            body: body || "could not extract body",
        };
    }

    // ── RFC822 multipart splitter ─────────────────────────────────────────────

    /**
     * Find and decode all message/rfc822 parts within a MIME multipart message.
     * This handles the nested structure produced when Gmail exports a search
     * result as a single .eml containing multiple original messages.
     *
     * @param {string} raw  - Full raw .eml content
     * @returns {string[]}  - Array of decoded inner message strings
     */
    function extractRfc822Parts(raw) {
        const parts = [];

        const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);
        if (!boundaryMatch) return parts;

        const boundary = boundaryMatch[1].trim();
        const escaped  = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const sections = raw.split(new RegExp(`--${escaped}`, "g"));

        sections.forEach((section, idx) => {
            if (!/Content-Type:\s*message\/rfc822/i.test(section)) return;

            // Find start of the inner message (after the part's own headers)
            const bodyStart = section.indexOf("\r\n\r\n");
            const bodyStart2 = section.indexOf("\n\n");
            const start = bodyStart !== -1 ? bodyStart + 4
                        : bodyStart2 !== -1 ? bodyStart2 + 2
                        : -1;
            if (start === -1) return;

            let content = section.substring(start).trim();

            // Apps Script pipeline triple-encodes the inner message
            if (/Content-Transfer-Encoding:\s*base64/i.test(section)) {
                try {
                    content = tripleBase64Decode(content);
                } catch (e) {
                    console.warn("Triple base64 decode failed in section", idx, e);
                    return;
                }
            }

            parts.push(content);
        });

        return parts;
    }

    // ── Per-file entry point ──────────────────────────────────────────────────

    /**
     * Process a single raw .eml string into one or more receipt objects.
     *
     * If the file is a multipart container holding nested RFC822 messages
     * (the Apps Script export format), each inner message becomes one receipt.
     * Otherwise the file itself is treated as a single message.
     *
     * @param {string} raw       - Raw .eml file contents
     * @param {string} fileName  - Original filename (used for debug logging only)
     * @returns {Array<{ receipt_index, subject, date, sender, body }>}
     */
    function processSingleEml(raw, fileName) {
        const parts = extractRfc822Parts(raw);

        if (parts.length > 0) {
            // Nested multi-message container
            return parts.map((part, i) => parseMessage(part, i));
        }

        // Single standalone message
        const result = parseMessage(raw, 0);
        if (result.body === "could not extract body" || !result.body.trim()) {
            console.warn("Empty body for", fileName);
        }
        return [result];
    }

    // ── Main entry point ──────────────────────────────────────────────────────

    /**
     * Process a .zip file containing one or more .eml files.
     *
     * @param {File}   zipFile              - Browser File object (.zip)
     * @param {object} [options]
     * @param {string} [options.participantId]  - Override prolific/participant ID
     *
     * @returns {Promise<object>} When receipt_stripping.js is loaded: same shape as email_worker.js
     *   (prolific_id, original_subject, processed_at, receipt_count, receipts with sent_at, platform, …).
     *   Otherwise raw parse: receipts with subject, date, sender, body.
     */
    async function processEmailReceiptsZip(zipFile, options) {
        if (!global.JSZip) {
            throw new Error("JSZip is not loaded. Add it before this script.");
        }

        const opts = options || {};
        const zip  = await global.JSZip.loadAsync(zipFile);

        // Collect and sort .eml paths for deterministic ordering
        const emlPaths = [];
        zip.forEach((relativePath, entry) => {
            if (!entry.dir && relativePath.toLowerCase().endsWith(".eml")) {
                emlPaths.push(relativePath);
            }
        });
        emlPaths.sort();

        if (emlPaths.length === 0) {
            throw new Error("No .eml files found in the zip.");
        }

        // Parse every file
        const allReceipts = [];
        for (const path of emlPaths) {
            const raw  = await zip.file(path).async("string");
            const recs = processSingleEml(raw, path);
            allReceipts.push(...recs);
        }

        // Re-index sequentially across all files
        allReceipts.forEach((r, i) => { r.receipt_index = i + 1; });

        // Participant ID: explicit option wins, else "NOT FOUND"
        const prolificId = (opts.participantId && String(opts.participantId).trim())
            || "NOT FOUND";

        const raw = {
            prolific_id:   prolificId,
            processed_at:  new Date().toISOString(),
            receipt_count: allReceipts.length,
            receipts:      allReceipts,
        };

        const rx = global.receiptExtractor;
        if (rx && typeof rx.summarizeAll === "function") {
            const originalSubject =
                opts.originalSubject != null && String(opts.originalSubject).length
                    ? String(opts.originalSubject).trim()
                    : prolificId;
            return rx.summarizeAll(raw, { original_subject: originalSubject });
        }

        return raw;
    }

    // ── Exports ───────────────────────────────────────────────────────────────

    const api = {
        // Low-level utilities (useful for testing)
        decodeQuotedPrintable,
        base64DecodeToString,
        tripleBase64Decode,
        htmlToPlainText,
        extractHeader,
        extractRfc822Parts,
        parseMessage,
        processSingleEml,
        // Main entry point
        processEmailReceiptsZip,
        // Legacy alias — old code that called processEmailReceiptsZipForPreview still works
        processEmailReceiptsZipForPreview: processEmailReceiptsZip,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    } else {
        global.emlDeanon = api;
        // Legacy namespace alias
        global.emlDeanonBrowser = api;
        // delivery/hub.js and older pages call this on window directly
        global.processEmailReceiptsZipForPreview = processEmailReceiptsZip;
    }

})(typeof window !== "undefined" ? window : globalThis);