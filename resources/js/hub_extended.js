const LAMBDA_URL = "https://sywq97zasl.execute-api.us-east-2.amazonaws.com/upload";

let rideshareDataEntered = false;
let outputData = {};
let uberData = null;
let lyftData = null;
let doordashData = null;
let instacartData = null;

function getProlificId() {
    const input = document.getElementById('prolificIdInput');
    return input ? input.value.trim() : "";
}

function hasUber() { return document.getElementById('hasUberCheckbox').checked; }
function hasLyft() { return document.getElementById('hasLyftCheckbox').checked; }
function hasDoordash() { return document.getElementById('hasDoordashCheckbox').checked; }
function hasInstacart() { return document.getElementById('hasInstacartCheckbox').checked; }

function normalizeCSVHeader(raw) {
    let s = String(raw).trim();
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1).trim();
    while (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
        s = s.slice(1, -1).trim();
    }
    return s;
}

function parseCSV(csvText) {
    if (csvText == null || csvText === '') return [];
    let text = String(csvText);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return [];

    const headers = lines[0].split(',').map(h => normalizeCSVHeader(h));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const values = [];
        let currentValue = '';
        let inQuotes = false;

        for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(currentValue.trim().replace(/^"|"$/g, ''));
                currentValue = '';
            } else {
                currentValue += char;
            }
        }
        values.push(currentValue.trim().replace(/^"|"$/g, ''));

        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        rows.push(row);
    }
    return rows;
}

// parse timestamp in format "2024-03-14 06:51:38 UTC"
function parseTimestamp(timestampStr) {
    if (!timestampStr) return null;
    try {
        const date = new Date(timestampStr);
        return isNaN(date.getTime()) ? null : date;
    } catch (e) {
        return null;
    }
}

// find matching payments within 2 minutes for multiple timestamps
function findMatchingPayments(timestampStrs, paymentsMap) {
    if (!timestampStrs || timestampStrs.length === 0) return -1;

    const twoMinutesMs = 120 * 1000;
    let maxAmount = -Infinity;
    let hasMatch = false;

    for (const timestampStr of timestampStrs) {
        if (!timestampStr) continue;

        const targetDate = parseTimestamp(timestampStr);
        if (!targetDate) continue;

        const targetTime = targetDate.getTime();

        for (const [paymentCreatedAt, amount] of paymentsMap.entries()) {
            const paymentDate = parseTimestamp(paymentCreatedAt);
            if (!paymentDate) continue;

            const paymentTime = paymentDate.getTime();
            const timeDiff = Math.abs(targetTime - paymentTime);

            if (timeDiff <= twoMinutesMs) {
                const amountNum = parseFloat(amount) || 0;
                if (amountNum > maxAmount) {
                    maxAmount = amountNum;
                    hasMatch = true;
                }
            }
        }
    }

    return hasMatch ? maxAmount : -1;
}

function processUberData(zipFile) {
    return new Promise(async (resolve, reject) => {
        try {
            const uberData = { user_profile: null, user_orders: [], trips_data: [] };

            // Profile
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('user_profile') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    if (rows.length > 0) uberData.user_profile = { Rating: rows[0].Rating || null };
                    break;
                }
            }

            // Orders
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('user_orders') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    uberData.user_orders = rows
                        .filter(row => row.Order_Status === 'completed')
                        .map(row => ({
                            City_Name: row.City_Name || '',
                            Request_Time_Local: row.Request_Time_Local || '',
                            Final_Delivery_Time_Local: row.Final_Delivery_Time_Local || '',
                            Order_Status: row.Order_Status || '',
                            Order_Price: row.Order_Price || ''
                        }));
                    break;
                }
            }

            // Trips
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('trips_data') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    uberData.trips_data = rows
                        .filter(row => row.status === 'completed')
                        .map(row => ({
                            product_type: row.product_type || '',
                            status: row.status || '',
                            request_time: row.request_time || '',
                            begin_trip_time: row.begin_trip_time || '',
                            dropoff_time: row.dropoff_time || '',
                            city: row.city || '',
                            begintrip_lat: row.begintrip_lat || '',
                            begintrip_lng: row.begintrip_lng || '',
                            dropoff_lat: row.dropoff_lat || '',
                            dropoff_lng: row.dropoff_lng || '',
                            dropoff_time: row.dropoff_time || '',
                            distance: row.distance || '',
                            fare_amount: row.fare_amount || '',
                        }));
                    break;
                }
            }
            resolve(uberData);
        } catch (error) { reject(error); }
    });
}

function processLyftData(zipFile) {
    return new Promise(async (resolve, reject) => {
        try {
            const lyftData = { user_ratings: [], passenger_rides: [] };

            // Ratings
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('user_ratings') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    lyftData.user_ratings = rows
                        .filter(row => row.role === 'passenger')
                        .map(row => ({ average_rating: row.average_rating || '', role: row.role || '' }));
                    break;
                }
            }

            // Payments - extract created_at and amount
            const paymentsMap = new Map(); // Map of created_at -> amount
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('payments_from_user') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    rows.forEach(row => {
                        const createdAt = row.created_at || '';
                        const amount = row.amount || '';
                        if (createdAt) {
                            paymentsMap.set(createdAt, amount);
                        }
                    });
                    break;
                }
            }

            // Rides - match with payments using created_at
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('passenger_rides') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    lyftData.passenger_rides = rows
                        .filter(row => row.status === 'finished')
                        .map(row => {
                            const ride = {
                                status: row.status || '',
                                requested_timestamp: row.requested_timestamp || '',
                                requested_lat: row.requested_lat || '',
                                requested_lng: row.requested_lng || '',
                                pickup_timestamp: row.pickup_timestamp || '',
                                pickup_lat: row.pickup_lat || '',
                                pickup_lng: row.pickup_lng || '',
                                dropoff_timestamp: row.dropoff_timestamp || '',
                                dropoff_lat: row.dropoff_lat || '',
                                dropoff_lng: row.dropoff_lng || '',
                            };

                            // Match payment using requested_timestamp OR dropoff_timestamp (within 2 minutes)
                            const requestedTimestamp = row.requested_timestamp || '';
                            const dropOffTimestamp = row.dropoff_timestamp || '';
                            const matchingAmount = findMatchingPayments([requestedTimestamp, dropOffTimestamp], paymentsMap);
                            if (matchingAmount !== -1) {
                                ride.payment_amount = matchingAmount;
                            }

                            return ride;
                        });
                    break;
                }
            }
            resolve(lyftData);
        } catch (error) { reject(error); }
    });
}

function processDoordashData(zipFile) {
    return new Promise(async (resolve, reject) => {
        try {
            const result = { doordash_orders: [] };

            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('consumer_order_details') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    result.doordash_orders = rows.map(row => ({
                        CREATED_AT: row.CREATED_AT || '',
                        DELIVERY_TIME: row.DELIVERY_TIME || '',
                        SUBTOTAL: row.SUBTOTAL || '',
                        STORE_NAME: row.STORE_NAME || ''
                    }));
                    break;
                }
            }

            resolve(result);
        } catch (error) { reject(error); }
    });
}

function processInstacartData(zipFile) {
    return new Promise(async (resolve, reject) => {
        try {
            const result = { instacart_orders: [], instacart_deliveries: [] };

            // orders_orders.csv
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('orders_orders') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    result.instacart_orders = rows.map(row => ({
                        Completed_At: row['Completed At'] || '',
                        Delivery_Date: row['Delivery Date'] || '',
                        Order_Num: row['Order Num'] || '',
                        Reconciled_Total: row['Reconciled Total'] || ''
                    }));
                    break;
                }
            }

            // orders_order_deliveries.csv
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('orders_order_deliveries') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    result.instacart_deliveries = rows.map(row => ({
                        Delivery_Type: row['Delivery Type'] || '',
                        Delivered_At: row['Delivered At'] || '',
                        Order_Num: row['Order Num'] || '',
                        dropoff_lat: row.dropoff_lat || '',
                        dropoff_lng: row.dropoff_lng || ''
                    }));
                    break;
                }
            }

            resolve(result);
        } catch (error) { reject(error); }
    });
}

function updateFileUploadVisibility() {
    const uberSection = document.getElementById('uberUploadSection');
    const lyftSection = document.getElementById('lyftUploadSection');
    const doordashSection = document.getElementById('doordashUploadSection');
    const instacartSection = document.getElementById('instacartUploadSection');

    if (uberSection) {
        if (hasUber()) {
            uberSection.style.display = 'block';
        } else {
            uberSection.style.display = 'none';
            uberData = null;
            const input = document.getElementById('uberFileInput');
            const nameSpan = document.getElementById('uberFileName');
            const inputDiv = document.getElementById('uberFileInputDiv');
            if (input) input.value = '';
            if (nameSpan) nameSpan.innerHTML = 'No file selected';
            if (inputDiv) inputDiv.classList.remove('is-danger');
        }
    }

    if (lyftSection) {
        if (hasLyft()) {
            lyftSection.style.display = 'block';
        } else {
            lyftSection.style.display = 'none';
            lyftData = null;
            const input = document.getElementById('lyftFileInput');
            const nameSpan = document.getElementById('lyftFileName');
            const inputDiv = document.getElementById('lyftFileInputDiv');
            if (input) input.value = '';
            if (nameSpan) nameSpan.innerHTML = 'No file selected';
            if (inputDiv) inputDiv.classList.remove('is-danger');
        }
    }

    if (doordashSection) {
        if (hasDoordash()) {
            doordashSection.style.display = 'block';
        } else {
            doordashSection.style.display = 'none';
            doordashData = null;
            const input = document.getElementById('doordashFileInput');
            const nameSpan = document.getElementById('doordashFileName');
            const inputDiv = document.getElementById('doordashFileInputDiv');
            if (input) input.value = '';
            if (nameSpan) nameSpan.innerHTML = 'No file selected';
            if (inputDiv) inputDiv.classList.remove('is-danger');
        }
    }

    if (instacartSection) {
        if (hasInstacart()) {
            instacartSection.style.display = 'block';
        } else {
            instacartSection.style.display = 'none';
            instacartData = null;
            const input = document.getElementById('instacartFileInput');
            const nameSpan = document.getElementById('instacartFileName');
            const inputDiv = document.getElementById('instacartFileInputDiv');
            if (input) input.value = '';
            if (nameSpan) nameSpan.innerHTML = 'No file selected';
            if (inputDiv) inputDiv.classList.remove('is-danger');
        }
    }

    validateAndProcessData();
}

async function validateAndProcessData() {
    try {
        const fileError = document.getElementById("file-error-message");
        const fileErrorSpecial = document.getElementById("file-error-message-special");
        const uberDiv = document.getElementById("uberFileInputDiv");
        const lyftDiv = document.getElementById("lyftFileInputDiv");
        const doordashDiv = document.getElementById("doordashFileInputDiv");
        const instacartDiv = document.getElementById("instacartFileInputDiv");
        const submitBtn = document.getElementById("submitZipButton");

        if (fileError) fileError.classList.remove("is-active");
        if (fileErrorSpecial) fileErrorSpecial.classList.remove("is-active");
        if (uberDiv) uberDiv.classList.remove("is-danger");
        if (lyftDiv) lyftDiv.classList.remove("is-danger");
        if (doordashDiv) doordashDiv.classList.remove("is-danger");
        if (instacartDiv) instacartDiv.classList.remove("is-danger");
        if (submitBtn) submitBtn.style.display = 'none';

        const pid = getProlificId();
        const shouldHaveUber = hasUber();
        const shouldHaveLyft = hasLyft();
        const shouldHaveDoordash = hasDoordash();
        const shouldHaveInstacart = hasInstacart();

        // 1. CHECK PROLIFIC ID
        if (!pid || pid.length === 0) {
            rideshareDataEntered = false;
            return;
        }

        // 2. CHECK FILES
        if (shouldHaveUber && !uberData) { rideshareDataEntered = false; return; }
        if (shouldHaveLyft && !lyftData) { rideshareDataEntered = false; return; }
        if (shouldHaveDoordash && !doordashData) { rideshareDataEntered = false; return; }
        if (shouldHaveInstacart && !instacartData) { rideshareDataEntered = false; return; }
        if (!shouldHaveUber && !shouldHaveLyft && !shouldHaveDoordash && !shouldHaveInstacart) {
            rideshareDataEntered = false;
            return;
        }

        // 3. MINIMUM DATA WARNING
        const passengerRidesCount = lyftData ? (lyftData.passenger_rides || []).length : 0;
        const userOrdersCount = uberData ? (uberData.user_orders || []).length : 0;
        const tripsDataCount = uberData ? (uberData.trips_data || []).length : 0;
        const doordashOrdersCount = doordashData ? (doordashData.doordash_orders || []).length : 0;
        const instacartOrdersCount = instacartData ? (instacartData.instacart_orders || []).length : 0;
        const instacartDeliveriesCount = instacartData ? (instacartData.instacart_deliveries || []).length : 0;

        const totalCount =
            passengerRidesCount +
            userOrdersCount +
            tripsDataCount +
            doordashOrdersCount +
            instacartOrdersCount +
            instacartDeliveriesCount;

        if (totalCount < 5 && fileErrorSpecial) {
            fileErrorSpecial.innerText = "Warning: We detected fewer than 5 combined rides/orders/trips. Please confirm there are at least 5 in the preview.";
            fileErrorSpecial.classList.add("is-active");
        } else if (fileErrorSpecial) {
            fileErrorSpecial.classList.remove("is-active");
        }

        // 4. PREPARE OUTPUT
        outputData = {
            currentTime: Date.now(),
            timezoneOffset: new Date().getTimezoneOffset(),
            prolificId: pid,
            uberData: uberData,
            lyftData: lyftData,
            doordashData: doordashData,
            instacartData: instacartData
        };

        const visual = document.getElementById('dataVisual');
        if (visual) visual.value = JSON.stringify(outputData, null, 2);
        rideshareDataEntered = true;
        if (submitBtn) submitBtn.style.display = 'inline-block';

    } catch (error) {
        console.error(error);
        rideshareDataEntered = false;
        const fileError = document.getElementById("file-error-message");
        if (fileError) fileError.classList.add("is-active");
    }
}

// Sync ProlificID between both sections
function syncProlificIds() {
    const zipPidInput = document.getElementById('prolificIdInput');
    const screenshotPidInput = document.getElementById('screenshotProlificIdInput');

    if (zipPidInput && screenshotPidInput) {
        zipPidInput.addEventListener('input', () => {
            screenshotPidInput.value = zipPidInput.value;
            updateScreenshotSubmitButtonState();
        });

        screenshotPidInput.addEventListener('input', () => {
            zipPidInput.value = screenshotPidInput.value;
            validateAndProcessData();
        });
    }
}

document.getElementById('hasUberCheckbox').addEventListener('change', updateFileUploadVisibility);
document.getElementById('hasLyftCheckbox').addEventListener('change', updateFileUploadVisibility);
document.getElementById('hasDoordashCheckbox').addEventListener('change', updateFileUploadVisibility);
document.getElementById('hasInstacartCheckbox').addEventListener('change', updateFileUploadVisibility);
document.getElementById('prolificIdInput').addEventListener('input', validateAndProcessData);

// Uber Input
document.getElementById('uberFileInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById("uberFileName").innerHTML = file.name;
    try {
        const zipFile = await JSZip.loadAsync(file);
        uberData = await processUberData(zipFile);
        await validateAndProcessData();
    } catch (error) {
        uberData = null;
        const fileError = document.getElementById("file-error-message");
        const inputDiv = document.getElementById("uberFileInputDiv");
        if (fileError) fileError.classList.add("is-active");
        if (inputDiv) inputDiv.classList.add("is-danger");
    }
});

// Lyft Input
document.getElementById('lyftFileInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById("lyftFileName").innerHTML = file.name;
    try {
        const zipFile = await JSZip.loadAsync(file);
        lyftData = await processLyftData(zipFile);
        await validateAndProcessData();
    } catch (error) {
        lyftData = null;
        const fileError = document.getElementById("file-error-message");
        const inputDiv = document.getElementById("lyftFileInputDiv");
        if (fileError) fileError.classList.add("is-active");
        if (inputDiv) inputDiv.classList.add("is-danger");
    }
});

// Doordash Input
document.getElementById('doordashFileInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById("doordashFileName").innerHTML = file.name;
    try {
        const zipFile = await JSZip.loadAsync(file);
        doordashData = await processDoordashData(zipFile);
        await validateAndProcessData();
    } catch (error) {
        doordashData = null;
        const fileError = document.getElementById("file-error-message");
        const inputDiv = document.getElementById("doordashFileInputDiv");
        if (fileError) fileError.classList.add("is-active");
        if (inputDiv) inputDiv.classList.add("is-danger");
    }
});

// Instacart Input
document.getElementById('instacartFileInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    document.getElementById("instacartFileName").innerHTML = file.name;
    try {
        const zipFile = await JSZip.loadAsync(file);
        instacartData = await processInstacartData(zipFile);
        await validateAndProcessData();
    } catch (error) {
        instacartData = null;
        const fileError = document.getElementById("file-error-message");
        const inputDiv = document.getElementById("instacartFileInputDiv");
        if (fileError) fileError.classList.add("is-active");
        if (inputDiv) inputDiv.classList.add("is-danger");
    }
});

document.getElementById('submitZipButton').onclick = async (event) => {
    const btn = event.target;
    btn.classList.add("is-loading");
    const submitError = document.getElementById('submit-error');
    if (submitError) submitError.classList.add("hidden");

    if (!rideshareDataEntered) return;

    try {
        const pid = getProlificId();

        // 1. Request Signed URL (S3 Key: PID/ride_data.json)
        const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const fileName = `ride_data_${uniqueSuffix}.json`;

        const signedRes = await fetch(LAMBDA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pid: pid, fileName })
        });

        if (!signedRes.ok) throw new Error("Failed to get signed URL");
        const { uploadUrl } = await signedRes.json();

        // 2. Upload JSON to S3
        const uploadRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(outputData)
        });

        if (!uploadRes.ok) throw new Error("Upload failed");

        // 3. SUCCESS -> Show success message
        const submitContainer = btn.parentElement;
        let successMsg = submitContainer ? submitContainer.querySelector('.zip-upload-success') : null;
        if (!successMsg && submitContainer) {
            successMsg = document.createElement('div');
            successMsg.className = 'notification is-success is-light zip-upload-success';
            successMsg.style.marginTop = '1rem';
            successMsg.innerHTML = '<i class="fas fa-check-circle"></i> Ride data uploaded successfully!';
            const existingError = document.getElementById('submit-error');
            if (existingError && existingError.parentElement === submitContainer) {
                submitContainer.insertBefore(successMsg, existingError.nextSibling);
            } else {
                submitContainer.insertBefore(successMsg, btn);
            }
        }

    } catch (err) {
        console.error(err);
        const submitError = document.getElementById('submit-error');
        if (submitError) submitError.classList.remove("hidden");
    } finally {
        btn.classList.remove("is-loading");
    }
};

// --- SCREENSHOT UPLOAD FUNCTIONALITY ---

let filesToUpload = [];
const MAX_FILES = 20;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];

function initializeScreenshotUpload() {
    const dropArea = document.getElementById('drop-area');
    const fileElem = document.getElementById('fileElem');
    const gallery = document.getElementById('gallery');
    const submitBtn = document.getElementById('submitScreenshotsButton');

    if (!dropArea || !fileElem || !gallery || !submitBtn) return;

    if (dropArea.dataset.initialized === 'true') return;
    dropArea.dataset.initialized = 'true';

    filesToUpload = [];
    gallery.innerHTML = '';
    const errorBox = document.getElementById('upload-error');
    const successBox = document.getElementById('upload-success');
    const progressBar = document.getElementById('upload-progress');
    if (errorBox) errorBox.classList.add('hidden');
    if (successBox) successBox.classList.add('hidden');
    if (progressBar) progressBar.classList.add('hidden');
    updateScreenshotSubmitButtonState();

    ['dragenter','dragover','dragleave','drop'].forEach(ev =>
        dropArea.addEventListener(ev, e => { e.preventDefault(); e.stopPropagation(); }, false));
    ['dragenter','dragover'].forEach(ev =>
        dropArea.addEventListener(ev, () => dropArea.classList.add('highlight')));
    ['dragleave','drop'].forEach(ev =>
        dropArea.addEventListener(ev, () => dropArea.classList.remove('highlight')));
    dropArea.addEventListener('drop', e => handleScreenshotFiles(e.dataTransfer.files));
    dropArea.addEventListener('click', () => fileElem.click());
    fileElem.addEventListener('change', e => handleScreenshotFiles(e.target.files));

    submitBtn.onclick = submitScreenshots;

    const screenshotPidInput = document.getElementById('screenshotProlificIdInput');
    if (screenshotPidInput) {
        screenshotPidInput.addEventListener('input', updateScreenshotSubmitButtonState);
    }
}

function getScreenshotProlificId() {
    const input = document.getElementById('screenshotProlificIdInput');
    return input ? input.value.trim() : "";
}

function handleScreenshotFiles(files) {
    const newFiles = [...files];
    const errorBox = document.getElementById('upload-error');
    if (errorBox) errorBox.classList.add('hidden');

    if (filesToUpload.length + newFiles.length > MAX_FILES) {
        const errorText = document.getElementById('error-text');
        if (errorText) errorText.innerText = `Maximum ${MAX_FILES} files allowed.`;
        if (errorBox) errorBox.classList.remove('hidden');
        return;
    }

    newFiles.forEach(file => {
        if (!ALLOWED_TYPES.includes(file.type)) {
            alert(`${file.name} is not a supported image type.`);
            return;
        }
        const isExactDuplicate = filesToUpload.some(f =>
            f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
        if (!isExactDuplicate) {
            filesToUpload.push(file);
            previewScreenshotFile(file, filesToUpload.length);
        }
    });
    updateScreenshotSubmitButtonState();
}

function previewScreenshotFile(file, index) {
    const gallery = document.getElementById('gallery');
    if (!gallery) return;

    const previewDiv = document.createElement('div');
    previewDiv.classList.add('file-preview');

    const icon = document.createElement('i');
    icon.classList.add('fas', 'fa-image');

    const nameSpan = document.createElement('span');
    nameSpan.classList.add('file-name-text');
    const isGenericName = file.name.toLowerCase().startsWith('image') ||
                          file.name.toLowerCase().startsWith('photo');
    nameSpan.innerText = isGenericName ? `Screenshot ${index}` : file.name;

    const removeBtn = document.createElement('div');
    removeBtn.classList.add('remove-file');
    removeBtn.innerHTML = '&times;';
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        filesToUpload = filesToUpload.filter(f => f !== file);
        previewDiv.remove();
        updateScreenshotSubmitButtonState();
    };

    previewDiv.appendChild(removeBtn);
    previewDiv.appendChild(icon);
    previewDiv.appendChild(nameSpan);
    gallery.appendChild(previewDiv);
}

function updateScreenshotSubmitButtonState() {
    const submitBtn = document.getElementById('submitScreenshotsButton');
    if (submitBtn) {
        submitBtn.disabled = !(getScreenshotProlificId() && filesToUpload.length > 0);
    }
}

function arrayBufferToBinaryString(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return bin;
}

function extractExifFromArrayBuffer(ab) {
    try {
        const bin = arrayBufferToBinaryString(ab);
        if (typeof EXIF !== 'undefined' && EXIF.readFromBinaryFile) {
            return EXIF.readFromBinaryFile(bin) || {};
        }
        return {};
    } catch (e) {
        return {};
    }
}

function parsePngChunks(ab) {
    const data = new DataView(ab);
    const decoder = new TextDecoder('utf-8');
    const result = { tEXt: {}, iTXt: {}, tIME: null };

    const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    for (let i = 0; i < 8; i++) {
        if (data.getUint8(i) !== pngSignature[i]) return result;
    }

    let offset = 8;
    while (offset + 8 <= data.byteLength) {
        const length = data.getUint32(offset);
        offset += 4;
        const type = String.fromCharCode(
            data.getUint8(offset),
            data.getUint8(offset + 1),
            data.getUint8(offset + 2),
            data.getUint8(offset + 3)
        );
        offset += 4;
        if (offset + length > data.byteLength) break;
        const chunkBytes = new Uint8Array(ab, offset, length);
        offset += length + 4;

        if (type === 'tEXt') {
            const txt = decoder.decode(chunkBytes);
            const idx = txt.indexOf('\u0000');
            if (idx >= 0) result.tEXt[txt.slice(0, idx)] = txt.slice(idx + 1);
        } else if (type === 'iTXt') {
            const txt = decoder.decode(chunkBytes);
            const parts = txt.split('\u0000');
            if (parts.length >= 2) {
                const key = parts[0];
                const text = parts.slice(parts.length - 1).join('\u0000');
                result.iTXt[key] = text;
            }
        } else if (type === 'tIME') {
            if (length === 7) {
                const year = (chunkBytes[0] << 8) + chunkBytes[1];
                const mo = chunkBytes[2], day = chunkBytes[3],
                      hh = chunkBytes[4], mm = chunkBytes[5], ss = chunkBytes[6];
                result.tIME = `${year.toString().padStart(4, '0')}:${mo.toString().padStart(2, '0')}:${day.toString().padStart(2, '0')} ${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
            }
        }
    }
    return result;
}

function normalizeTimestamp(rawCandidate) {
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
            const d = new Date(rawCandidate);
            if (!isNaN(d)) return d.toISOString();
        } catch (e) {}
        return null;
    })();
    return { raw: rawCandidate, iso: isoGuess, source: null };
}

async function extractMetadataForFile(file) {
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
                if (isoMatch) {
                    candidate = isoMatch[0];
                    source = 'iOS_iTXt_plist';
                } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(v)) {
                    candidate = v.split('\n')[0];
                    source = 'iOS_iTXt_plist';
                } else {
                    candidate = v;
                    source = 'iOS_iTXt_plist';
                }
            }
            if (!candidate && png.tIME) {
                candidate = png.tIME;
                source = 'PNG_tIME';
            }
            if (!candidate && Object.keys(png.tEXt || {}).length) {
                const keys = Object.keys(png.tEXt);
                const prefer = ['Creation Time', 'CreationTime', 'creation_time', 'timestamp', 'Date', 'Time', 'date:create', 'date:modify'];
                for (const k of prefer) {
                    if (png.tEXt[k]) {
                        candidate = png.tEXt[k];
                        source = 'PNG_tEXt';
                        break;
                    }
                }
                if (!candidate) {
                    candidate = png.tEXt[keys[0]];
                    source = 'PNG_tEXt';
                }
            }
            const tryExif = extractExifFromArrayBuffer(ab) || {};
            if (!candidate && Object.keys(tryExif).length) {
                candidate = tryExif.DateTimeOriginal || tryExif.CreateDate || null;
                source = 'PNG_exif_like';
                exif = tryExif;
            }
        } else {
            exif = extractExifFromArrayBuffer(ab) || {};
            if (Object.keys(exif).length) {
                candidate = exif.DateTimeOriginal || exif.CreateDate || exif.ModifyDate;
            }
        }

        let normalized = normalizeTimestamp(candidate);
        if (normalized.iso) {
            normalized.source = source || normalized.source || 'parsed';
        } else {
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

async function submitScreenshots() {
    const pid = getScreenshotProlificId();
    if (!pid || filesToUpload.length === 0) return;

    const submitBtn = document.getElementById('submitScreenshotsButton');
    const progressBar = document.getElementById('upload-progress');

    submitBtn.classList.add('is-loading');
    progressBar.classList.remove('hidden');
    progressBar.removeAttribute('value');
    const errorBox = document.getElementById('upload-error');
    if (errorBox) errorBox.classList.add('hidden');

    try {
        const zip = new JSZip();
        const metadata = {};

        const metaPromises = filesToUpload.map(f => extractMetadataForFile(f));
        const allMeta = await Promise.all(metaPromises);

        for (let i = 0; i < filesToUpload.length; i++) {
            const file = filesToUpload[i];
            const parts = file.name.split('.');
            const ext = parts.length > 1 ? parts.pop() : "jpg";
            const uniqueName = `screenshot_${i + 1}.${ext}`;

            const zipOptions = {};
            if (file.lastModified && !isNaN(file.lastModified)) {
                zipOptions.date = new Date(file.lastModified);
            }
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

        const zipBlob = await zip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: { level: 6 }
        });

        const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const fileName = `screenshots_${uniqueSuffix}.zip`;

        const signedUrlResponse = await fetch(LAMBDA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pid: pid, fileName: fileName })
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
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve();
                else reject(new Error(`Upload failed: ${xhr.statusText}`));
            };
            xhr.onerror = () => reject(new Error("Network error"));
            xhr.send(zipBlob);
        });

        const dropArea = document.getElementById('drop-area');
        const gallery = document.getElementById('gallery');
        if (dropArea) dropArea.style.display = 'none';
        if (gallery) gallery.style.display = 'none';
        if (submitBtn) submitBtn.style.display = 'none';
        if (progressBar) progressBar.style.display = 'none';

        const qualtricsLink = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_3OivXqzAcxkJhzw/?ProlificID=${encodeURIComponent(pid)}`;
        const successDiv = document.getElementById('upload-success');
        if (successDiv) {
            successDiv.classList.remove('hidden');
            successDiv.innerHTML = `
                <h4 class="title is-5">Upload Complete!</h4>
                <p style="margin-bottom: 1rem;">Your screenshots have been securely uploaded.</p>
                <a href="${qualtricsLink}" class="button is-success is-medium">
                    Continue to Final Survey &raquo;
                </a>
            `;
        }
    } catch (error) {
        console.error("Upload failed:", error);
        const errorBoxLocal = document.getElementById('upload-error');
        const errorText = document.getElementById('error-text');
        if (errorText) errorText.innerText = "Upload failed. Please check your connection and try again.";
        if (errorBoxLocal) errorBoxLocal.classList.remove('hidden');
    } finally {
        if (submitBtn) submitBtn.classList.remove('is-loading');
    }
}

// Initialize screenshot upload and ride upload on page load
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const participantIdFromURL = urlParams.get('participantId');
    const prolificIdFromURL = urlParams.get('ProlificID'); // Backward compatibility
    const participantIdFromSession = sessionStorage.getItem('participantId');

    const participantId = participantIdFromURL || prolificIdFromURL || participantIdFromSession;

    if (participantId) {
        const uploadSections = document.getElementById('uploadSections');
        if (uploadSections) uploadSections.style.display = 'block';

        const returnSection = document.getElementById('returnParticipantSection');
        if (returnSection) returnSection.style.display = 'none';

        const zipPidInput = document.getElementById('prolificIdInput');
        const screenshotPidInput = document.getElementById('screenshotProlificIdInput');
        if (zipPidInput) zipPidInput.value = participantId;
        if (screenshotPidInput) screenshotPidInput.value = participantId;

        syncProlificIds();
        initializeScreenshotUpload();
        validateAndProcessData();
        updateScreenshotSubmitButtonState();
    } else {
        const returnSection = document.getElementById('returnParticipantSection');
        if (returnSection) returnSection.style.display = 'block';

        const uploadSections = document.getElementById('uploadSections');
        if (uploadSections) uploadSections.style.display = 'none';

        const continueWithIdButton = document.getElementById('continueWithIdButton');
        const returnParticipantIdInput = document.getElementById('returnParticipantIdInput');

        if (continueWithIdButton && returnParticipantIdInput) {
            continueWithIdButton.addEventListener('click', () => {
                const enteredId = returnParticipantIdInput.value.trim();
                if (enteredId) {
                    const zipPidInput = document.getElementById('prolificIdInput');
                    const screenshotPidInput = document.getElementById('screenshotProlificIdInput');
                    if (zipPidInput) zipPidInput.value = enteredId;
                    if (screenshotPidInput) screenshotPidInput.value = enteredId;

                    sessionStorage.setItem('participantId', enteredId);

                    const uploadSections = document.getElementById('uploadSections');
                    if (uploadSections) uploadSections.style.display = 'block';

                    if (returnSection) returnSection.style.display = 'none';

                    syncProlificIds();
                    initializeScreenshotUpload();
                    validateAndProcessData();
                    updateScreenshotSubmitButtonState();
                }
            });

            returnParticipantIdInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    continueWithIdButton.click();
                }
            });
        }
    }
});


