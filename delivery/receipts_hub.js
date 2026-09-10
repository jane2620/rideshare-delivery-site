/**
 * Delivery study only — email receipts: local .zip → anonymized JSON (eml_deanon_browser.js),
 * upload JSON to S3 (not the raw zip). Gates main JSON submit. Loaded after /resources/js/hub.js.
 * (Formerly delivery/hub.js.)
 */
(function () {
    "use strict";

    const LAMBDA_URL = window.APP_CONFIG.LAMBDA_URL;

    let emailReceiptsZipFile = null;
    /** True after anonymized receipts JSON was successfully uploaded to S3 */
    let emailReceiptsJsonUploaded = false;
    let previewDirty = false;
    /** "folder" (default) or "zip" */
    let emailReceiptsUploadMode = "folder";

    /**
     * Build an in-memory .zip (as a Blob) from a folder's selected .eml files,
     * so the existing zip-based processing pipeline can be reused unchanged.
     */
    async function buildZipFromFolderFiles(fileList) {
        if (!window.JSZip) {
            throw new Error("JSZip is not loaded. Please refresh the page.");
        }
        const emlFiles = Array.from(fileList || []).filter(function (f) {
            return f.name.toLowerCase().endsWith(".eml");
        });
        if (emlFiles.length === 0) {
            throw new Error("No .eml files found in the selected folder.");
        }
        const zip = new window.JSZip();
        for (const file of emlFiles) {
            const content = await file.text();
            zip.file(file.name, content);
        }
        return await zip.generateAsync({ type: "blob" });
    }

    function getProlificId() {
        const input = document.getElementById("emailInput");
        return input ? input.value.trim() : "";
    }

    function emailReceiptsRequirementSatisfied() {
        const emailZipRequiredAttr = document.body ? document.body.dataset.emailZipRequired : "";
        if (emailZipRequiredAttr !== "true") {
            return true;
        }
        const forwarded = document.getElementById("emailReceiptsForwardedCheckbox");
        if (forwarded && forwarded.checked) {
            return true;
        }
        return emailReceiptsJsonUploaded;
    }

    window.hubEmailReceiptsGateErrorText =
        "Please confirm you forwarded receipts to receipts@delivery-study.com, or upload your anonymized email receipts (JSON) above, before submitting.";

    window.hubEmailReceiptsGate = emailReceiptsRequirementSatisfied;

    function clearOptionalReceiptsUploadState() {
        emailReceiptsZipFile = null;
        emailReceiptsJsonUploaded = false;
        const input = document.getElementById("emailReceiptsZipInput");
        if (input) input.value = "";
        const nameSpan = document.getElementById("emailReceiptsZipFileName");
        if (nameSpan) nameSpan.innerText = "No file selected";
        const folderInput = document.getElementById("emailReceiptsFolderInput");
        if (folderInput) folderInput.value = "";
        const folderNameSpan = document.getElementById("emailReceiptsFolderFileName");
        if (folderNameSpan) folderNameSpan.innerText = "No folder selected";
        const previewTa = document.getElementById("emailReceiptsJsonPreview");
        if (previewTa) previewTa.value = "";
        const previewErr = document.getElementById("emailReceiptsPreviewError");
        if (previewErr) {
            previewErr.classList.add("hidden");
            previewErr.textContent = "";
        }
        const errBox = document.getElementById("emailZip-error");
        const okBox = document.getElementById("emailZip-success");
        if (errBox) errBox.classList.add("hidden");
        if (okBox) okBox.classList.add("hidden");
    }

    /** Hide .zip / JSON upload UI when participant already forwarded emails to the study inbox */
    function syncForwardedCheckboxOptionalSection() {
        const cb = document.getElementById("emailReceiptsForwardedCheckbox");
        const section = document.getElementById("emailReceiptsOptionalUploadSection");
        if (!cb || !section) return;
        if (cb.checked) {
            section.classList.add("hidden");
            clearOptionalReceiptsUploadState();
        } else {
            section.classList.remove("hidden");
        }
    }

    async function refreshEmailReceiptsJsonPreview() {
        const previewTa = document.getElementById("emailReceiptsJsonPreview");
        const previewErr = document.getElementById("emailReceiptsPreviewError");
        if (!previewTa && !previewErr) return;
        if (previewErr) {
            previewErr.classList.add("hidden");
            previewErr.textContent = "";
        }
        if (!emailReceiptsZipFile || typeof window.processEmailReceiptsZipForPreview !== "function") {
            if (previewTa) previewTa.value = "";
            return;
        }

        if (previewTa && previewDirty) {
            return;
        }
        try {
            const hint = getProlificId();
            const json = await window.processEmailReceiptsZipForPreview(emailReceiptsZipFile, { participantId: hint });
            if (previewTa) previewTa.value = JSON.stringify(json, null, 2);
        } catch (e) {
            console.error(e);
            if (previewTa) previewTa.value = "";
            if (previewErr) {
                previewErr.textContent = e.message || "Could not build a JSON preview from the .zip.";
                previewErr.classList.remove("hidden");
            }
        }
    }

    const emailReceiptsZipInput = document.getElementById("emailReceiptsZipInput");
    const emailReceiptsFolderInput = document.getElementById("emailReceiptsFolderInput");
    const submitEmailReceiptsButton = document.getElementById("submitEmailReceiptsZipButton");
    const resetEmailReceiptsPreviewButton = document.getElementById("resetEmailReceiptsPreviewButton");
    const emailReceiptsModeFolderButton = document.getElementById("emailReceiptsModeFolderButton");
    const emailReceiptsModeZipButton = document.getElementById("emailReceiptsModeZipButton");
    const emailReceiptsFolderInputField = document.getElementById("emailReceiptsFolderInputField");
    const emailReceiptsZipInputField = document.getElementById("emailReceiptsZipInputField");

    if (!emailReceiptsZipInput || !submitEmailReceiptsButton) {
        return;
    }

    const emailReceiptsForwardedCheckbox = document.getElementById("emailReceiptsForwardedCheckbox");
    if (emailReceiptsForwardedCheckbox) {
        emailReceiptsForwardedCheckbox.addEventListener("change", function () {
            syncForwardedCheckboxOptionalSection();
            if (typeof validateAndProcessData === "function") validateAndProcessData();
        });
    }
    syncForwardedCheckboxOptionalSection();

    function setEmailReceiptsUploadMode(mode) {
        emailReceiptsUploadMode = mode;
        clearOptionalReceiptsUploadState();
        if (emailReceiptsFolderInputField) emailReceiptsFolderInputField.classList.toggle("hidden", mode !== "folder");
        if (emailReceiptsZipInputField) emailReceiptsZipInputField.classList.toggle("hidden", mode !== "zip");
        if (emailReceiptsModeFolderButton) emailReceiptsModeFolderButton.classList.toggle("is-selected", mode === "folder");
        if (emailReceiptsModeFolderButton) emailReceiptsModeFolderButton.classList.toggle("is-primary", mode === "folder");
        if (emailReceiptsModeZipButton) emailReceiptsModeZipButton.classList.toggle("is-selected", mode === "zip");
        if (emailReceiptsModeZipButton) emailReceiptsModeZipButton.classList.toggle("is-primary", mode === "zip");
        if (typeof validateAndProcessData === "function") validateAndProcessData();
    }

    if (emailReceiptsModeFolderButton) {
        emailReceiptsModeFolderButton.addEventListener("click", function () {
            setEmailReceiptsUploadMode("folder");
        });
    }
    if (emailReceiptsModeZipButton) {
        emailReceiptsModeZipButton.addEventListener("click", function () {
            setEmailReceiptsUploadMode("zip");
        });
    }

    emailReceiptsZipInput.addEventListener("change", async function (event) {
        const file = event.target.files[0];
        emailReceiptsZipFile = file || null;
        emailReceiptsJsonUploaded = false;
        previewDirty = false;
        const nameSpan = document.getElementById("emailReceiptsZipFileName");
        if (nameSpan) {
            nameSpan.innerText = file ? file.name : "No file selected";
        }
        await refreshEmailReceiptsJsonPreview();
    });

    if (emailReceiptsFolderInput) {
        emailReceiptsFolderInput.addEventListener("change", async function (event) {
            const files = event.target.files;
            emailReceiptsJsonUploaded = false;
            previewDirty = false;
            const nameSpan = document.getElementById("emailReceiptsFolderFileName");
            const previewErr = document.getElementById("emailReceiptsPreviewError");

            if (!files || files.length === 0) {
                emailReceiptsZipFile = null;
                if (nameSpan) nameSpan.innerText = "No folder selected";
                await refreshEmailReceiptsJsonPreview();
                return;
            }

            const folderName = files[0].webkitRelativePath
                ? files[0].webkitRelativePath.split("/")[0]
                : "Selected folder";
            const emlCount = Array.from(files).filter(function (f) {
                return f.name.toLowerCase().endsWith(".eml");
            }).length;
            if (nameSpan) {
                nameSpan.innerText = `${folderName} (${emlCount} .eml file${emlCount === 1 ? "" : "s"})`;
            }

            try {
                emailReceiptsZipFile = await buildZipFromFolderFiles(files);
            } catch (e) {
                emailReceiptsZipFile = null;
                if (previewErr) {
                    previewErr.textContent = e.message || "Could not read the selected folder.";
                    previewErr.classList.remove("hidden");
                }
            }
            await refreshEmailReceiptsJsonPreview();
        });
    }

    const previewTa = document.getElementById("emailReceiptsJsonPreview");
    if (previewTa) {
        previewTa.addEventListener("input", function () {
            previewDirty = true;
        });
    }

    if (resetEmailReceiptsPreviewButton) {
        resetEmailReceiptsPreviewButton.addEventListener("click", async function () {
            previewDirty = false;
            await refreshEmailReceiptsJsonPreview();
        });
    }

    submitEmailReceiptsButton.addEventListener("click", async function () {
        const errorBox = document.getElementById("emailZip-error");
        const successBox = document.getElementById("emailZip-success");
        if (errorBox) errorBox.classList.add("hidden");
        if (successBox) successBox.classList.add("hidden");

        const pid = getProlificId();
        if (!pid) {
            if (errorBox) {
                errorBox.innerText = "Please enter your Prolific ID before uploading.";
                errorBox.classList.remove("hidden");
            }
            return;
        }

        if (!emailReceiptsZipFile) {
            if (errorBox) {
                errorBox.innerText = emailReceiptsUploadMode === "folder"
                    ? "Please choose a folder of .eml receipts first."
                    : "Please choose a .zip file of .eml receipts first.";
                errorBox.classList.remove("hidden");
            }
            return;
        }

        if (typeof window.processEmailReceiptsZipForPreview !== "function") {
            if (errorBox) {
                errorBox.innerText = "Receipt processor is not loaded. Please refresh the page.";
                errorBox.classList.remove("hidden");
            }
            return;
        }

        submitEmailReceiptsButton.classList.add("is-loading");

        try {
            // Upload what is currently in the preview textarea (user-editable).
            const previewEl = document.getElementById("emailReceiptsJsonPreview");
            const previewText = previewEl ? previewEl.value.trim() : "";
            if (!previewText) {
                throw new Error("Preview is empty. Choose a .zip to generate a preview first.");
            }

            let receiptPayload;
            try {
                receiptPayload = JSON.parse(previewText);
            } catch (e) {
                throw new Error("Preview is not valid JSON. Please fix it or click Reset from .zip.");
            }

            // Minimal shape validation
            if (!receiptPayload || typeof receiptPayload !== "object") {
                throw new Error("Preview JSON must be an object.");
            }
            if (!Array.isArray(receiptPayload.receipts)) {
                throw new Error('Preview JSON must include a "receipts" array.');
            }
            // Keep IDs consistent with the typed Prolific ID (same as email_worker outer subject)
            receiptPayload.prolific_id = pid;
            receiptPayload.participant_id = pid;
            receiptPayload.original_subject = pid;

            const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const fileName = `delivery_email_receipts_${uniqueSuffix}.json`;

            const studyType = document.body ? document.body.dataset.studyType : "";
            const signedPayload = { pid: pid, fileName: fileName, tag: "delivery_email_json" };
            if (studyType) {
                signedPayload.studyType = studyType;
            }

            const signedRes = await fetch(LAMBDA_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(signedPayload),
            });

            if (!signedRes.ok) {
                throw new Error("Failed to get signed URL for email receipts JSON");
            }

            const { uploadUrl } = await signedRes.json();
            if (!uploadUrl) {
                throw new Error("No uploadUrl returned for email receipts JSON");
            }

            const uploadRes = await fetch(uploadUrl, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(receiptPayload),
            });

            if (!uploadRes.ok) {
                throw new Error("Upload failed for email receipts JSON");
            }

            if (successBox) {
                successBox.innerText = "Anonymized email receipts (JSON) uploaded successfully. You may return to the survey.";
                successBox.classList.remove("hidden");
            }
            emailReceiptsJsonUploaded = true;
            previewDirty = false;
            if (typeof validateAndProcessData === "function") validateAndProcessData();
        } catch (err) {
            console.error(err);
            emailReceiptsJsonUploaded = false;
            if (errorBox) {
                errorBox.innerText =
                    err.message && err.message.length < 200
                        ? err.message
                        : "Upload failed. Please check your connection and try again.";
                errorBox.classList.remove("hidden");
            }
        } finally {
            submitEmailReceiptsButton.classList.remove("is-loading");
        }
    });

    const prolificIdInput = document.getElementById("emailInput");
    if (prolificIdInput) {
        prolificIdInput.addEventListener("input", function () {
            // If they haven't edited the preview, keep it in sync with their ID.
            refreshEmailReceiptsJsonPreview();
        });
    }
})();
