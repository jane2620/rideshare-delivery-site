let filesToUpload = [];
const MAX_FILES = 20;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

const dropArea = document.getElementById('drop-area');
const fileElem = document.getElementById('fileElem');
const gallery = document.getElementById('gallery');
const submitBtn = document.getElementById('submitButton');
const progressBar = document.getElementById('upload-progress');

window.addEventListener('DOMContentLoaded', () => {
    const emailFromURL = getURLParameter('email');
    const prolificIdFromURL = getURLParameter('ProlificID'); // Backward compatibility
    const email = emailFromURL || prolificIdFromURL;
    
    if (email) {
        const emailInput = document.getElementById('emailInput');
        const prolificIdInput = document.getElementById('prolificIdInput'); // Backward compatibility
        if (emailInput) {
            emailInput.value = email;
            emailInput.readOnly = true;
        } else if (prolificIdInput) {
            prolificIdInput.value = email;
            prolificIdInput.readOnly = true;
        }
    }
    updateSubmitButtonState();
});

function getURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

function getEmail() {
    const emailInput = document.getElementById('emailInput');
    if (emailInput) return emailInput.value.trim();
    // Backward compatibility
    const prolificIdInput = document.getElementById('prolificIdInput');
    return prolificIdInput ? prolificIdInput.value.trim() : "";
}

function getProlificId() {
    return getEmail();
}

['dragenter','dragover','dragleave','drop'].forEach(ev => dropArea.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false));
['dragenter','dragover'].forEach(ev => dropArea.addEventListener(ev, () => dropArea.classList.add('highlight')));
['dragleave','drop'].forEach(ev => dropArea.addEventListener(ev, () => dropArea.classList.remove('highlight')));
dropArea.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
dropArea.addEventListener('click', () => fileElem.click());
fileElem.addEventListener('change', e => handleFiles(e.target.files));

function handleFiles(files) {
    const newFiles = [...files];
    const errorBox = document.getElementById('upload-error');
    errorBox.classList.add('hidden');
    if (filesToUpload.length + newFiles.length > MAX_FILES) {
        document.getElementById('error-text').innerText = `Maximum ${MAX_FILES} files allowed.`;
        errorBox.classList.remove('hidden');
        return;
    }
    newFiles.forEach(file => {
        if (!ALLOWED_TYPES.includes(file.type)) { alert(`${file.name} is not a supported image type.`); return; }
        const isExactDuplicate = filesToUpload.some(f => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
        if (!isExactDuplicate) { filesToUpload.push(file); previewFile(file, filesToUpload.length); }
    });
    updateSubmitButtonState();
}
function previewFile(file,index){
    const previewDiv=document.createElement('div'); previewDiv.classList.add('file-preview');
    const icon=document.createElement('i'); icon.classList.add('fas','fa-image');
    const nameSpan=document.createElement('span'); nameSpan.classList.add('file-name-text');
    const isGenericName = file.name.toLowerCase().startsWith('image') || file.name.toLowerCase().startsWith('photo');
    nameSpan.innerText = isGenericName ? `Screenshot ${index}` : file.name;
    const removeBtn=document.createElement('div'); removeBtn.classList.add('remove-file'); removeBtn.innerHTML='&times;';
    removeBtn.onclick = (e) => { e.stopPropagation(); filesToUpload = filesToUpload.filter(f => f !== file); previewDiv.remove(); updateSubmitButtonState(); };
    previewDiv.appendChild(removeBtn); previewDiv.appendChild(icon); previewDiv.appendChild(nameSpan); gallery.appendChild(previewDiv);
}
function updateSubmitButtonState() { 
    submitBtn.disabled = !(getEmail() && filesToUpload.length > 0); 
}
const emailInput = document.getElementById('emailInput');
const prolificIdInput = document.getElementById('prolificIdInput'); // Backward compatibility
if (emailInput) {
    emailInput.addEventListener('input', updateSubmitButtonState);
} else if (prolificIdInput) {
    prolificIdInput.addEventListener('input', updateSubmitButtonState);
}

function arrayBufferToBinaryString(buf){
    const bytes = new Uint8Array(buf);
    let bin = '', chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return bin;
}


function extractExifFromArrayBuffer(ab){
    try {
        const bin = arrayBufferToBinaryString(ab);
        if (typeof EXIF !== 'undefined' && EXIF.readFromBinaryFile) {
            return EXIF.readFromBinaryFile(bin) || {};
        }
        // fallback: try getData approach (works with File objects normally)
        return {};
    } catch (e) { return {}; }
}


function parsePngChunks(ab){
    const data = new DataView(ab);
    const decoder = new TextDecoder('utf-8');
    const result = { tEXt: {}, iTXt: {}, tIME: null };
    // verify PNG signature
    const pngSignature = [0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A];
    for (let i=0;i<8;i++) if (data.getUint8(i) !== pngSignature[i]) return result;
    let offset = 8;
    while (offset + 8 <= data.byteLength) {
        const length = data.getUint32(offset); offset += 4;
        const type = String.fromCharCode(data.getUint8(offset), data.getUint8(offset+1), data.getUint8(offset+2), data.getUint8(offset+3));
        offset += 4;
        if (offset + length > data.byteLength) break;
        const chunkBytes = new Uint8Array(ab, offset, length);
        offset += length + 4; // skip CRC
        if (type === 'tEXt') {
            const txt = decoder.decode(chunkBytes);
            const idx = txt.indexOf('\u0000');
            if (idx >= 0) result.tEXt[txt.slice(0, idx)] = txt.slice(idx+1);
        } else if (type === 'iTXt') {
            const txt = decoder.decode(chunkBytes);
            const parts = txt.split('\u0000');
            if (parts.length >= 2) {
                const key = parts[0];
                const text = parts.slice(parts.length-1).join('\u0000');
                result.iTXt[key] = text;
            }
        } else if (type === 'tIME') {
            if (length === 7) {
                const year = (chunkBytes[0]<<8) + chunkBytes[1];
                const mo = chunkBytes[2], day = chunkBytes[3], hh = chunkBytes[4], mm = chunkBytes[5], ss = chunkBytes[6];
                result.tIME = `${year.toString().padStart(4,'0')}:${mo.toString().padStart(2,'0')}:${day.toString().padStart(2,'0')} ${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')}:${ss.toString().padStart(2,'0')}`;
            }
        }
    }
    return result;
}

function normalizeTimestamp(rawCandidate){
    if (!rawCandidate) return { raw: null, iso: null, source: null };
    const isoGuess = (() => {
        try {
            if (/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(rawCandidate)) {
                const s = rawCandidate.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T').replace(' ', 'T') + 'Z';
                const d = new Date(s);
                if (!isNaN(d)) return d.toISOString();
            }
            if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(rawCandidate)) {
                const s = rawCandidate.split(' ')[0] + 'T' + rawCandidate.split(' ')[1] + 'Z';
                const d = new Date(s);
                if (!isNaN(d)) return d.toISOString();
            }
            // Handle plain ISO or RFC
            const d = new Date(rawCandidate);
            if (!isNaN(d)) return d.toISOString();
        } catch (e) {}
        return null;
    })();
    return { raw: rawCandidate, iso: isoGuess, source: null };
}

async function extractMetadataForFile(file){
    try {
        const ab = await file.arrayBuffer();
        let exif = {}, png = {}, candidate = null, source = null;

        if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
            exif = extractExifFromArrayBuffer(ab) || {};
            candidate = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate || exif.DateTime || null;
            if (candidate) source = 'EXIF';
        } else if (file.type === 'image/png') {
            png = parsePngChunks(ab) || {};
            const appleKey = Object.keys(png.iTXt || {}).find(k => k && k.includes('com.apple.metadata'));
            if (appleKey && png.iTXt[appleKey]) {
                const v = png.iTXt[appleKey];
                const isoMatch = v.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
                if (isoMatch) { candidate = isoMatch[0]; source = 'iOS_iTXt_plist'; }
                else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(v)) { candidate = v.split('\n')[0]; source = 'iOS_iTXt_plist'; }
                else { candidate = v; source = 'iOS_iTXt_plist'; }
            }
            if (!candidate && png.tIME) { candidate = png.tIME; source = 'PNG_tIME'; }
            if (!candidate && Object.keys(png.tEXt||{}).length) {
                const keys = Object.keys(png.tEXt);
                const prefer = ['Creation Time','CreationTime','creation_time','timestamp','Date','Time','date:create','date:modify'];
                for (const k of prefer) if (png.tEXt[k]) { candidate = png.tEXt[k]; source = 'PNG_tEXt'; break; }
                if (!candidate) { candidate = png.tEXt[keys[0]]; source = 'PNG_tEXt'; }
            }
            const tryExif = extractExifFromArrayBuffer(ab) || {};
            if (!candidate && Object.keys(tryExif).length) { candidate = tryExif.DateTimeOriginal || tryExif.CreateDate || null; source = 'PNG_exif_like'; exif = tryExif; }
        } else {
            exif = extractExifFromArrayBuffer(ab) || {};
            if (Object.keys(exif).length) candidate = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate;
        }

        let normalized = normalizeTimestamp(candidate);
        if (normalized.iso) normalized.source = source || normalized.source || 'parsed';
        else {
            if (file.lastModified && !isNaN(file.lastModified)) {
                const d = new Date(file.lastModified).toISOString();
                normalized = { raw: String(file.lastModified), iso: d, source: 'lastModified' };
            } else {
                normalized = { raw: null, iso: null, source: null };
            }
        }

        return {
            timestamp_raw: normalized.raw,
            timestamp_iso: normalized.iso,
            source: normalized.source,
            raw_exif: exif,
            raw_png: png
        };

    } catch (err) {
        console.warn('metadata extraction failed', file.name, err);
        if (file.lastModified && !isNaN(file.lastModified)) {
            return {
                timestamp_raw: String(file.lastModified),
                timestamp_iso: new Date(file.lastModified).toISOString(),
                source: 'lastModified',
                raw_exif: {},
                raw_png: {}
            };
        }
        return { timestamp_raw: null, timestamp_iso: null, source: null, raw_exif: {}, raw_png: {} };
    }
}

// --- Submit logic ---
submitBtn.onclick = async () => {
    const pid = getEmail();
    
    if (!pid || filesToUpload.length === 0) return;

    submitBtn.classList.add('is-loading');
    progressBar.classList.remove('hidden');
    progressBar.removeAttribute('value');
    document.getElementById('upload-error').classList.add('hidden');

    const LAMBDA_URL = window.APP_CONFIG.LAMBDA_URL;

    try {
        // Build ZIP with metadata.json
        const zip = new JSZip();
        const metadata = {};

        // extract metadata in parallel
        const metaPromises = filesToUpload.map(f => extractMetadataForFile(f));
        const allMeta = await Promise.all(metaPromises);

        for (let i = 0; i < filesToUpload.length; i++) {
            const file = filesToUpload[i];
            const parts = file.name.split('.');
            const ext = parts.length > 1 ? parts.pop() : "jpg";
            const uniqueName = `screenshot_${i + 1}.${ext}`;

            const zipOptions = {};
            if (file.lastModified && !isNaN(file.lastModified)) zipOptions.date = new Date(file.lastModified);
            zip.file(uniqueName, file, zipOptions);

            metadata[uniqueName] = {
                timestamp_raw: allMeta[i].timestamp_raw,
                timestamp_iso: allMeta[i].timestamp_iso,
                source: allMeta[i].source,
                raw_exif: allMeta[i].raw_exif,
                raw_png: allMeta[i].raw_png,
                original_name: file.name,
                size: file.size,
                lastModified: file.lastModified || null
            };
        }

        zip.file("metadata.json", JSON.stringify(metadata, null, 2));

        console.log('Files in ZIP:', Object.keys(zip.files));
        console.log('Metadata being added:', metadata);

        const zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });

        const s3Key = `${pid}_screenshots.zip`;
        const signedUrlResponse = await fetch(LAMBDA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pid: pid, fileName: s3Key })
        });
        if (!signedUrlResponse.ok) throw new Error("Failed to get upload URL");
        const { uploadUrl } = await signedUrlResponse.json();

        await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", uploadUrl);
            xhr.setRequestHeader("Content-Type", "application/zip");
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const percent = (e.loaded / e.total) * 100;
                    progressBar.value = percent;
                    progressBar.innerText = `${Math.round(percent)}%`;
                }
            };
            xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(`Upload failed: ${xhr.statusText}`)); };
            xhr.onerror = () => reject(new Error("Network error"));
            xhr.send(zipBlob);
        });

        if(dropArea) dropArea.style.display = 'none';
        if(gallery) gallery.style.display = 'none';
        if(submitBtn) submitBtn.style.display = 'none';
        if(progressBar) progressBar.style.display = 'none';

        const qualtricsLink = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_bji54RkKPiC7z5I?ProlificID=${encodeURIComponent(pid)}`;
        const successDiv = document.getElementById('upload-success');
        successDiv.classList.remove('hidden');
        successDiv.innerHTML = `
            <h4 class="title is-5">Upload Complete!</h4>
            <p style="margin-bottom: 1rem;">Your screenshots have been securely uploaded.</p>
            <a href="${qualtricsLink}" class="button is-success is-medium" target="_blank">
                Continue to Final Survey &raquo;
            </a>
        `;
    } catch (error) {
        console.error("Upload failed:", error);
        const errorBox = document.getElementById('upload-error');
        document.getElementById('error-text').innerText = "Upload failed. Please check your connection and try again.";
        errorBox.classList.remove('hidden');
    } finally {
        if(submitBtn) submitBtn.classList.remove('is-loading');
    }
};
