
const LAMBDA_URL = window.APP_CONFIG.LAMBDA_URL;

let rideshareDataEntered = false;
let outputData = {};
let uberData = null;
let lyftData = null;
let doordashData = null;
let grubhubData = null;
let instacartData = { orders: [], deliveries: [] };

function getEmail() {
    const input = document.getElementById('emailInput');
    return input ? input.value.trim() : "";
}

// Backward compatibility alias
function getProlificId() {
    return getEmail();
}

function hasUber() { return document.getElementById('hasUberCheckbox').checked; }
function hasLyft() { return document.getElementById('hasLyftCheckbox').checked; }
function hasDoorDash() { return document.getElementById('hasDoorDashCheckbox').checked; }
function hasGrubhub() { return document.getElementById('hasGrubhubCheckbox').checked; }
function hasInstacart() { return document.getElementById('hasInstacartCheckbox').checked; }

// 0/1 flags for which platforms actually had data uploaded (not just checked),
// passed through to Qualtrics so the survey can dynamically branch per platform.
function getPlatformFlags() {
    const instacartHasData = Boolean(
        instacartData && ((instacartData.orders || []).length > 0 || (instacartData.deliveries || []).length > 0)
    );
    return {
        has_uber: uberData ? 1 : 0,
        has_lyft: lyftData ? 1 : 0,
        has_doordash: doordashData ? 1 : 0,
        has_grubhub: grubhubData ? 1 : 0,
        has_instacart: instacartHasData ? 1 : 0,
    };
}

// Append the platform flags onto a Qualtrics survey URL, preserving any params already on it.
function buildQualtricsUrl(baseUrl) {
    const url = new URL(baseUrl);
    Object.entries(getPlatformFlags()).forEach(([key, value]) => {
        url.searchParams.set(key, value);
    });
    return url.toString();
}

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

// Helper function to get column value case-insensitively, trying multiple variations
function getColumnValue(row, columnName, alternatives = []) {
    if (!row || !columnName) return '';
    
    // Try all column names (primary + alternatives)
    const allNames = [columnName, ...alternatives];
    
    for (const name of allNames) {
        // First try exact match
        if (row[name] !== undefined) {
            return row[name] || '';
        }
        // Then try case-insensitive match
        const lowerName = name.toLowerCase();
        for (const key in row) {
            if (key.toLowerCase() === lowerName) {
                return row[key] || '';
            }
        }
    }
    return '';
}

// --- Privacy: fuzz geocoordinates (port of delivery/fuzz_coordinate.py) ---
const FUZZ_RADIUS_M = 500;
const EARTH_RADIUS_M = 6371000.0;

function deg2rad(deg) {
    return (deg * Math.PI) / 180;
}

function rad2deg(rad) {
    return (rad * 180) / Math.PI;
}

function fuzzCoordinates(lat, lon, radiusM) {
    // Keep empty/malformed values unchanged.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { lat, lon };

    // random distance + direction
    const u = Math.random(); // random distance scalar
    const v = Math.random(); // random direction
    const d = u * radiusM;
    const theta = v * 2.0 * Math.PI;

    const latRad = deg2rad(lat);
    const lonRad = deg2rad(lon);
    const delta = d / EARTH_RADIUS_M;

    const newLatRad = Math.asin(
        Math.sin(latRad) * Math.cos(delta) +
        Math.cos(latRad) * Math.sin(delta) * Math.cos(theta)
    );

    const newLonRad = lonRad + Math.atan2(
        Math.sin(theta) * Math.sin(delta) * Math.cos(latRad),
        Math.cos(delta) - Math.sin(latRad) * Math.sin(newLatRad)
    );

    return { lat: rad2deg(newLatRad), lon: rad2deg(newLonRad) };
}

function fuzzLatLngPair(latStr, lngStr, radiusM = FUZZ_RADIUS_M) {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return { lat: latStr, lng: lngStr };
    }
    const f = fuzzCoordinates(lat, lng, radiusM);
    // Maintain the existing schema type style (strings).
    return { lat: f.lat.toFixed(6), lng: f.lon.toFixed(6) };
}


function parseUSZipAndState(address) {
    const result = { zip: null, state: null };
    if (!address) return result;
    const str = String(address);

    const zipStateMatch = str.match(/\b([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
    if (zipStateMatch) {
        result.state = zipStateMatch[1];
        result.zip = zipStateMatch[2];
        return result;
    }

    const stateOnlyMatch = str.match(/,\s*([A-Z]{2})\s*(?:,|$)/);
    if (stateOnlyMatch) {
        result.state = stateOnlyMatch[1];
    }
    return result;
}

// parse timestamp in format "2024-03-14 06:51:38 UTC"
function parseTimestamp(timestampStr) {
    if (!timestampStr) return null;
    try {
        // Parse timestamp in format "2024-03-14 06:51:38 UTC"
        // JavaScript Date can parse this format directly
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
    
    // Check each timestamp
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
            const uberData = {
                user_profile: null,
                user_orders: [],
                trips_data: []
            };
            
            // Profile
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('user_profile') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    if (rows.length > 0) {
                        uberData.user_profile = { 
                            Rating: getColumnValue(rows[0], 'Rating') || null 
                        };
                    }
                    break;
                }
            }
            
            // Orders - user_orders-0.csv
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('user_orders') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    uberData.user_orders = rows
                        .filter(row => {
                            const orderStatus = getColumnValue(row, 'Order_Status');
                            return orderStatus && orderStatus.toLowerCase() === 'completed';
                        })
                        .map(row => ({
                            City_name: getColumnValue(row, 'City_name'),
                            Request_Time_Local: getColumnValue(row, 'Request_Time_Local'),
                            Final_Delivery_Time_local: getColumnValue(row, 'Final_Delivery_Time_local'),
                            Order_Status: getColumnValue(row, 'Order_Status'),
                            Customization_Cost_local: getColumnValue(row, 'Customization_Cost_local'),
                            Item_Price: getColumnValue(row, 'Item_Price'),
                            Item_quantity: getColumnValue(row, 'Item_quantity'),
                            Order_price: getColumnValue(row, 'Order_price'),
                            Currency: getColumnValue(row, 'Currency')
                        }));
                    break;
                }
            }
            
            // Trips - rider_lifetime_trips
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('rider_lifetime_trips') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    
                    uberData.trips_data = rows
                        .filter(row => {
                            const status = getColumnValue(row, 'status');
                            return status && status.toLowerCase() === 'completed';
                        })
                        .map(row => {
                            // Fuzz request/begintrip/dropoff coordinates for privacy.
                            const req = fuzzLatLngPair(
                                getColumnValue(row, 'request_lat'),
                                getColumnValue(row, 'request_lng')
                            );
                            const begin = fuzzLatLngPair(
                                getColumnValue(row, 'begintrip_lat'),
                                getColumnValue(row, 'begintrip_lng')
                            );
                            const drop = fuzzLatLngPair(
                                getColumnValue(row, 'dropoff_lat'),
                                getColumnValue(row, 'dropoff_lng')
                            );

                            return {
                                city_name: getColumnValue(row, 'city_name'),
                                currency_code: getColumnValue(row, 'currency_code'),
                                timezone: getColumnValue(row, 'timezone'),
                                client_device: getColumnValue(row, 'client_device'),
                                product_type_name: getColumnValue(row, 'product_type_name'),
                                request_timestamp_local: getColumnValue(row, 'request_timestamp_local'),
                                request_timestamp_utc: getColumnValue(row, 'request_timestamp_utc'),
                                request_lat: req.lat,
                                request_lng: req.lng,
                                begintrip_timestamp_local: getColumnValue(row, 'begintrip_timestamp_local'),
                                begintrip_timestamp_utc: getColumnValue(row, 'begintrip_timestamp_utc'),
                                begintrip_lat: begin.lat,
                                begintrip_lng: begin.lng,
                                dropoff_timestamp_local: getColumnValue(row, 'dropoff_timestamp_local'),
                                dropoff_timestamp_utc: getColumnValue(row, 'dropoff_timestamp_utc'),
                                dropoff_lat: drop.lat,
                                dropoff_lng: drop.lng,
                                eta: getColumnValue(row, 'eta'),
                                surge_multiplier: getColumnValue(row, 'surge_multiplier'),
                                is_surged: getColumnValue(row, 'is_surged'),
                                is_pool_matched: getColumnValue(row, 'is_pool_matched'),
                                request_to_begin_distance_miles: getColumnValue(row, 'request_to_begin_distance_miles'),
                                request_to_begin_duration_seconds: getColumnValue(row, 'request_to_begin_duration_seconds'),
                                trip_distance_miles: getColumnValue(row, 'trip_distance_miles'),
                                status: getColumnValue(row, 'status'),
                                is_completed: getColumnValue(row, 'is_completed'),
                                fare_amount: getColumnValue(row, 'fare_amount'),
                                is_fare_split: getColumnValue(row, 'is_fare_split'),
                                is_flat_rate: getColumnValue(row, 'is_flat_rate'),
                                is_cash_trip: getColumnValue(row, 'is_cash_trip'),
                                promotion_local: getColumnValue(row, 'promotion_local'),
                                promotion_usd: getColumnValue(row, 'promotion_usd'),
                                credits_local: getColumnValue(row, 'credits_local'),
                                credits_usd: getColumnValue(row, 'credits_usd'),
                                has_client_upfront_fare: getColumnValue(row, 'has_client_upfront_fare'),
                                client_upfront_fare_local: getColumnValue(row, 'client_upfront_fare_local'),
                                client_upfront_fare_usd: getColumnValue(row, 'client_upfront_fare_usd'),
                                original_fare_local: getColumnValue(row, 'original_fare_local'),
                                original_fare_usd: getColumnValue(row, 'original_fare_usd'),
                                base_fare_local: getColumnValue(row, 'base_fare_local'),
                                base_fare_usd: getColumnValue(row, 'base_fare_usd'),
                                surge_fare_local: getColumnValue(row, 'surge_fare_local'),
                                surge_fare_usd: getColumnValue(row, 'surge_fare_usd'),
                                minimum_fare_roundup_local: getColumnValue(row, 'minimum_fare_roundup_local'),
                                minimum_fare_roundup_usd: getColumnValue(row, 'minimum_fare_roundup_usd'),
                                per_mile_fare_local: getColumnValue(row, 'per_mile_fare_local'),
                                per_mile_fare_usd: getColumnValue(row, 'per_mile_fare_usd'),
                                per_minute_fare_local: getColumnValue(row, 'per_minute_fare_local'),
                                per_minute_fare_usd: getColumnValue(row, 'per_minute_fare_usd'),
                                cancellation_fee_local: getColumnValue(row, 'cancellation_fee_local'),
                                cancellation_fee_usd: getColumnValue(row, 'cancellation_fee_usd'),
                                rounding_down_amount_local: getColumnValue(row, 'rounding_down_amount_local'),
                                rounding_down_amount_usd: getColumnValue(row, 'rounding_down_amount_usd'),
                                service_fee_local: getColumnValue(row, 'service_fee_local'),
                                service_fee_usd: getColumnValue(row, 'service_fee_usd'),
                                toll_amount_local: getColumnValue(row, 'toll_amount_local'),
                                toll_amount_usd: getColumnValue(row, 'toll_amount_usd'),
                                booking_fee_local: getColumnValue(row, 'booking_fee_local'),
                                booking_fee_usd: getColumnValue(row, 'booking_fee_usd'),
                                earnings_boost_local: getColumnValue(row, 'earnings_boost_local'),
                                earnings_boost_usd: getColumnValue(row, 'earnings_boost_usd'),
                                fare_distance_miles: getColumnValue(row, 'fare_distance_miles'),
                                fare_duration_minutes: getColumnValue(row, 'fare_duration_minutes'),
                                concierge_source_type: getColumnValue(row, 'concierge_source_type'),
                                wait_time_fare_local: getColumnValue(row, 'wait_time_fare_local'),
                                wait_time_fare_usd: getColumnValue(row, 'wait_time_fare_usd'),
                                driver_cancellation_reason: getColumnValue(row, 'driver_cancellation_reason'),
                                is_multidestination: getColumnValue(row, 'is_multidestination'),
                                long_distance_surcharge_local: getColumnValue(row, 'long_distance_surcharge_local'),
                                long_distance_surcharge_usd: getColumnValue(row, 'long_distance_surcharge_usd'),
                                cancellation_type: getColumnValue(row, 'cancellation_type'),
                                is_directed_dispatch_trip: getColumnValue(row, 'is_directed_dispatch_trip'),
                                wait_duration_minutes: getColumnValue(row, 'wait_duration_minutes'),
                                is_scheduled_trip: getColumnValue(row, 'is_scheduled_trip'),
                                is_airport_trip: getColumnValue(row, 'is_airport_trip')
                            };
                        });
                    console.log('Processed trips_data count:', uberData.trips_data.length);
                    break;
                }
            }

            console.log('=== processUberData END ===');
            console.log('Final uberData summary:', {
                user_profile: uberData.user_profile,
                user_orders_count: uberData.user_orders.length,
                trips_data_count: uberData.trips_data.length
            });
            
            resolve(uberData);
        } catch (error) { 
            console.error('Error in processUberData:', error);
            reject(error); 
        }
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
                        .filter(row => {
                            const role = getColumnValue(row, 'role');
                            return role && role.toLowerCase() === 'passenger';
                        })
                        .map(row => ({ 
                            average_rating: getColumnValue(row, 'average_rating'), 
                            role: getColumnValue(row, 'role') 
                        }));
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
                        const createdAt = getColumnValue(row, 'created_at');
                        const amount = getColumnValue(row, 'amount');
                        if (createdAt) {
                            // Store payment by created_at timestamp
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
                        .filter(row => {
                            const status = getColumnValue(row, 'status');
                            return status && status.toLowerCase() === 'finished';
                        })
                        .map(row => {
                            const requested = fuzzLatLngPair(
                                getColumnValue(row, 'requested_lat'),
                                getColumnValue(row, 'requested_lng')
                            );
                            const pickup = fuzzLatLngPair(
                                getColumnValue(row, 'pickup_lat'),
                                getColumnValue(row, 'pickup_lng')
                            );
                            const dropoff = fuzzLatLngPair(
                                getColumnValue(row, 'dropoff_lat'),
                                getColumnValue(row, 'dropoff_lng')
                            );

                            const ride = {
                                status: getColumnValue(row, 'status'),
                                requested_timestamp: getColumnValue(row, 'requested_timestamp'),
                                requested_lat: requested.lat,
                                requested_lng: requested.lng,
                                pickup_timestamp: getColumnValue(row, 'pickup_timestamp'),
                                pickup_lat: pickup.lat,
                                pickup_lng: pickup.lng,
                                dropoff_timestamp: getColumnValue(row, 'dropoff_timestamp'),
                                dropoff_lat: dropoff.lat,
                                dropoff_lng: dropoff.lng,
                            };
                            
                            // Match payment using requested_timestamp OR dropoff_timestamp (within 2 minutes)
                            const requestedTimestamp = getColumnValue(row, 'requested_timestamp');
                            const dropOffTimestamp = getColumnValue(row, 'dropoff_timestamp');
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

function processDoorDashData(zipFile) {
    return new Promise(async (resolve, reject) => {
        try {
            const doordashData = { consumer_order_details: [] };
            
            // consumer_order_details.csv
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.includes('consumer_order_details') && fileName.endsWith('.csv')) {
                    const fileData = await zipFile.file(fileName).async("string");
                    const rows = parseCSV(fileData);
                    doordashData.consumer_order_details = rows.map(row => {
                        const { zip, state } = parseUSZipAndState(getColumnValue(row, 'DELIVERY_ADDRESS'));
                        return {
                            CREATED_AT: getColumnValue(row, 'CREATED_AT'),
                            DELIVERY_TIME: getColumnValue(row, 'DELIVERY_TIME'),
                            SUBTOTAL: getColumnValue(row, 'SUBTOTAL'),
                            STORE_NAME: getColumnValue(row, 'STORE_NAME'),
                            ITEM_NAME: getColumnValue(row, 'ITEM'),
                            UNIT_PRICE: getColumnValue(row, 'UNIT_PRICE'),
                            QUANTITY: getColumnValue(row, 'QUANTITY'),
                            DELIVERY_ZIP: zip,
                            DELIVERY_STATE: state,
                        };
                    });
                    break;
                }
            }
            
            resolve(doordashData);
        } catch (error) { reject(error); }
    });
}

// Parse a SheetJS workbook (already read from an .xlsx/.xls buffer) into grubhubData.
function parseGrubhubWorkbook(workbook) {
    const grubhubData = { orders: [], profile: null };

    // Process Orders sheet
    if (workbook.SheetNames.includes('Orders')) {
        const ordersSheet = workbook.Sheets['Orders'];
        const ordersRows = XLSX.utils.sheet_to_json(ordersSheet);

        grubhubData.orders = ordersRows
            .filter(row => {
                // Filter out cancelled orders
                const cancelledIndicator = getColumnValue(row, 'Cancelled Order Indicator');
                return cancelledIndicator !== 'Yes' && cancelledIndicator !== 'true' && cancelledIndicator !== '1';
            })
            .map(row => ({
                Order_Creation_Date: getColumnValue(row, 'Order Creation Date'),
                Order_Delivery_Time: getColumnValue(row, 'Order Delivery Time'),
                Browser_Type: getColumnValue(row, 'Browser Type'),
                Order_Timezone: getColumnValue(row, 'Order Timezone'),
                Cancelled_Order_Indicator: getColumnValue(row, 'Cancelled Order Indicator'),
                Delivery_Address_Lat: getColumnValue(row, 'Delivery Address Lat'),
                Delivery_Address_Lng: getColumnValue(row, 'Delivery Address Lng'),
                Order_Total: getColumnValue(row, 'Order Total'),
                Diner_Payment: getColumnValue(row, 'Diner Payment'),
                Order_Payment_Method: getColumnValue(row, 'Order Payment Method'),
                Order_Credit_Card_Type: getColumnValue(row, 'Order Credit Card Type'),
                Order_Currency: getColumnValue(row, 'Order Currency'),
                Restaurant_Zip_Code: getColumnValue(row, 'Restaurant Postal Code')
            }));
    }

    // Process Profile sheet
    if (workbook.SheetNames.includes('Profile')) {
        const profileSheet = workbook.Sheets['Profile'];
        const profileRows = XLSX.utils.sheet_to_json(profileSheet);

        if (profileRows.length > 0) {
            const profileRow = profileRows[0];
            grubhubData.profile = {
                Total_Lifetime_Orders: getColumnValue(profileRow, 'Total Lifetime Orders (excluding cancelled orders)'),
                Lifetime_Total_Order: getColumnValue(profileRow, 'Lifetime Total Order ($)'),
                Lifetime_Total_Promo: getColumnValue(profileRow, 'Lifetime Total Promo ($)'),
                GH_Plus_Subscription: getColumnValue(profileRow, 'GH Plus Subscription')
            };
        }
    }

    return grubhubData;
}

function processGrubhubData(zipFile) {
    return new Promise(async (resolve, reject) => {
        try {
            const emptyResult = { orders: [], profile: null };

            // Find Excel file
            let excelFile = null;
            for (const fileName of Object.keys(zipFile.files)) {
                if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
                    excelFile = fileName;
                    break;
                }
            }

            if (!excelFile) {
                resolve(emptyResult);
                return;
            }

            // Load Excel file as array buffer
            const excelBuffer = await zipFile.file(excelFile).async("arraybuffer");

            // Check if XLSX library is available
            if (typeof XLSX === 'undefined') {
                console.warn('XLSX library not loaded. Cannot parse Grubhub Excel file.');
                resolve(emptyResult);
                return;
            }

            const workbook = XLSX.read(excelBuffer, { type: 'array' });
            resolve(parseGrubhubWorkbook(workbook));
        } catch (error) {
            console.error('Error processing Grubhub data:', error);
            reject(error);
        }
    });
}

// Grubhub's DSAR export is a raw .xlsx/.xls file (not zipped); parse it directly.
function processGrubhubExcelFile(file) {
    return new Promise(async (resolve, reject) => {
        try {
            if (typeof XLSX === 'undefined') {
                console.warn('XLSX library not loaded. Cannot parse Grubhub Excel file.');
                resolve({ orders: [], profile: null });
                return;
            }
            const excelBuffer = await file.arrayBuffer();
            const workbook = XLSX.read(excelBuffer, { type: 'array' });
            resolve(parseGrubhubWorkbook(workbook));
        } catch (error) {
            console.error('Error processing Grubhub Excel file:', error);
            reject(error);
        }
    });
}

function isExcelFileName(name) {
    const lower = (name || '').toLowerCase();
    return lower.endsWith('.xlsx') || lower.endsWith('.xls');
}

// Grubhub uploads may be a .zip (older export) or a raw .xlsx/.xls (current DSAR export).
function processGrubhubUpload(file) {
    if (isExcelFileName(file.name)) {
        return processGrubhubExcelFile(file);
    }
    return JSZip.loadAsync(file).then(zipFile => processGrubhubData(zipFile));
}

function processInstacartOrdersCSV(csvText) {
    try {
        const rows = parseCSV(csvText);
        return rows
            .map(row => ({
                Completed_At: getColumnValue(row, 'Completed At'),
                Currency: getColumnValue(row, 'Currency'),
                Delivery_Date: getColumnValue(row, 'Delivery Date'),
                Initial_Tip_Type: getColumnValue(row, 'Initial Tip Type'),
                Order_Num: getColumnValue(row, 'Order Num'),
                Reconciled_Total: getColumnValue(row, 'Reconciled Total'),
                Reconciliation_Coupon_Discount: getColumnValue(row, 'Reconciliation Coupon Discount'),
                Sales_Tax: getColumnValue(row, 'Sales Tax')
            }));
    } catch (error) {
        console.error('Error processing Instacart orders CSV:', error);
        throw error;
    }
}

function processInstacartDeliveriesCSV(csvText) {
    try {
        const rows = parseCSV(csvText);
        return rows.map(row => ({
            Delivery_Type: getColumnValue(row, 'Delivery Type'),
            Delivered_At: getColumnValue(row, 'Delivered At'),
            Order_Num: getColumnValue(row, 'Order Num'),
            Weight: getColumnValue(row, 'Weight'),
            Frozen_Items: getColumnValue(row, 'Frozen Items'),
            Num_Bags: getColumnValue(row, 'Num Of Bags'),
        }));
    } catch (error) {
        throw error;
    }
}



function updateFileUploadVisibility() {
    const uberSection = document.getElementById('uberUploadSection');
    const lyftSection = document.getElementById('lyftUploadSection');
    const doordashSection = document.getElementById('doorDashUploadSection');
    const grubhubSection = document.getElementById('grubhubUploadSection');
    const instacartSection = document.getElementById('instacartUploadSection');
    
    if (uberSection) {
        if (hasUber()) {
            uberSection.style.display = 'block';
        } else {
            uberSection.style.display = 'none';
            uberData = null;
            resetUberUploadInputs();
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
        if (hasDoorDash()) {
            doordashSection.style.display = 'block';
        } else {
            doordashSection.style.display = 'none';
            doordashData = null;
            resetDoorDashUploadInputs();
        }
    }

    if (grubhubSection) {
        if (hasGrubhub()) {
            grubhubSection.style.display = 'block';
        } else {
            grubhubSection.style.display = 'none';
            grubhubData = null;
            const input = document.getElementById('grubhubFileInput');
            const nameSpan = document.getElementById('grubhubFileName');
            const inputDiv = document.getElementById('grubhubFileInputDiv');
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
            instacartData = { orders: [], deliveries: [] };
            const ordersInput = document.getElementById('instacartOrdersFileInput');
            const ordersNameSpan = document.getElementById('instacartOrdersFileName');
            const ordersInputDiv = document.getElementById('instacartOrdersFileInputDiv');
            const deliveriesInput = document.getElementById('instacartDeliveriesFileInput');
            const deliveriesNameSpan = document.getElementById('instacartDeliveriesFileName');
            const deliveriesInputDiv = document.getElementById('instacartDeliveriesFileInputDiv');
            if (ordersInput) ordersInput.value = '';
            if (ordersNameSpan) ordersNameSpan.innerHTML = 'No file selected';
            if (ordersInputDiv) ordersInputDiv.classList.remove('is-danger');
            if (deliveriesInput) deliveriesInput.value = '';
            if (deliveriesNameSpan) deliveriesNameSpan.innerHTML = 'No file selected';
            if (deliveriesInputDiv) deliveriesInputDiv.classList.remove('is-danger');
        }
    }
    
    validateAndProcessData();
}

async function validateAndProcessData() {
    try {
        // Reset Errors
        document.getElementById("file-error-message").classList.remove("is-active");
        const uberDiv = document.getElementById("uberFileInputDiv");
        const uberFolderDiv = document.getElementById("uberFolderInputDiv");
        const lyftDiv = document.getElementById("lyftFileInputDiv");
        const doordashDiv = document.getElementById("doorDashFileInputDiv");
        const doordashFolderDiv = document.getElementById("doorDashFolderInputDiv");
        const grubhubDiv = document.getElementById("grubhubFileInputDiv");
        const instacartOrdersDiv = document.getElementById("instacartOrdersFileInputDiv");
        const instacartDeliveriesDiv = document.getElementById("instacartDeliveriesFileInputDiv");
        if (uberDiv) uberDiv.classList.remove("is-danger");
        if (uberFolderDiv) uberFolderDiv.classList.remove("is-danger");
        if (lyftDiv) lyftDiv.classList.remove("is-danger");
        if (doordashDiv) doordashDiv.classList.remove("is-danger");
        if (doordashFolderDiv) doordashFolderDiv.classList.remove("is-danger");
        if (grubhubDiv) grubhubDiv.classList.remove("is-danger");
        if (instacartOrdersDiv) instacartOrdersDiv.classList.remove("is-danger");
        if (instacartDeliveriesDiv) instacartDeliveriesDiv.classList.remove("is-danger");
        const submitBtn = document.getElementById("submitZipButton");
        if (submitBtn) submitBtn.style.display = "none";
        const previewHintEl = document.getElementById("previewEmailHint");
        if (previewHintEl) previewHintEl.classList.add("hidden");
        
        const pid = getProlificId();
        const hasPid = pid && pid.length > 0;
        const shouldHaveUber = hasUber();
        const shouldHaveLyft = hasLyft();
        const shouldHaveDoorDash = hasDoorDash();
        const shouldHaveGrubhub = hasGrubhub();
        const shouldHaveInstacart = hasInstacart();

        // check files
        if (shouldHaveUber && !uberData) { rideshareDataEntered = false; return; }
        if (shouldHaveLyft && !lyftData) { rideshareDataEntered = false; return; }
        if (shouldHaveDoorDash && !doordashData) { rideshareDataEntered = false; return; }
        if (shouldHaveGrubhub && !grubhubData) { rideshareDataEntered = false; return; }
        if (shouldHaveInstacart && (!instacartData || (instacartData.orders.length === 0 && instacartData.deliveries.length === 0))) { 
            rideshareDataEntered = false; 
            return; 
        }
        if (!shouldHaveUber && !shouldHaveLyft && !shouldHaveDoorDash && !shouldHaveGrubhub && !shouldHaveInstacart) { 
            rideshareDataEntered = false;
            const dv = document.getElementById("dataVisual");
            if (dv) dv.value = "";
            const hint = document.getElementById("previewEmailHint");
            if (hint) hint.classList.add("hidden");
            return; 
        }
        
        // prep output
        outputData = {
            currentTime: Date.now(),
            timezoneOffset: new Date().getTimezoneOffset(),
            prolificId: pid || "",
            uberData: uberData,
            lyftData: lyftData,
            doordashData: doordashData,
            grubhubData: grubhubData,
            instacartData: instacartData
        };
        
        const dataVisual = document.getElementById("dataVisual");
        if (dataVisual) {
            dataVisual.value = JSON.stringify(outputData, null, 2);
        }
        if (previewHintEl) {
            if (hasPid) {
                previewHintEl.classList.add("hidden");
            } else {
                previewHintEl.classList.remove("hidden");
            }
        }
        // Preview shows as soon as files parse; submit when email + optional delivery receipt gate (www/delivery/receipts_hub.js)
        const receiptGateOk =
            typeof window.hubEmailReceiptsGate !== "function" || window.hubEmailReceiptsGate();
        const canSubmit = hasPid && receiptGateOk;
        rideshareDataEntered = canSubmit;
        if (submitBtn) submitBtn.style.display = canSubmit ? "inline-block" : "none";
        
    } catch (error) {
        console.error(error);
        rideshareDataEntered = false;
        document.getElementById("file-error-message").classList.add("is-active");
    }
}

const hasUberCheckbox = document.getElementById('hasUberCheckbox');
const hasLyftCheckbox = document.getElementById('hasLyftCheckbox');
const hasDoorDashCheckbox = document.getElementById('hasDoorDashCheckbox');
const hasGrubhubCheckbox = document.getElementById('hasGrubhubCheckbox');
const hasInstacartCheckbox = document.getElementById('hasInstacartCheckbox');

if (hasUberCheckbox) hasUberCheckbox.addEventListener('change', updateFileUploadVisibility);
if (hasLyftCheckbox) hasLyftCheckbox.addEventListener('change', updateFileUploadVisibility);
if (hasDoorDashCheckbox) hasDoorDashCheckbox.addEventListener('change', updateFileUploadVisibility);
if (hasGrubhubCheckbox) hasGrubhubCheckbox.addEventListener('change', updateFileUploadVisibility);
if (hasInstacartCheckbox) hasInstacartCheckbox.addEventListener('change', updateFileUploadVisibility);

const emailInput = document.getElementById('emailInput');
const prolificIdInput = document.getElementById('prolificIdInput');
if (emailInput) {
    emailInput.addEventListener('input', validateAndProcessData);
} else if (prolificIdInput) {
    prolificIdInput.addEventListener('input', validateAndProcessData);
}

function resetUberUploadInputs() {
    const zipInput = document.getElementById('uberFileInput');
    const zipName = document.getElementById('uberFileName');
    const zipDiv = document.getElementById('uberFileInputDiv');
    const folderInput = document.getElementById('uberFolderInput');
    const folderName = document.getElementById('uberFolderName');
    const folderDiv = document.getElementById('uberFolderInputDiv');
    if (zipInput) zipInput.value = '';
    if (zipName) zipName.innerHTML = 'No file selected';
    if (zipDiv) zipDiv.classList.remove('is-danger');
    if (folderInput) folderInput.value = '';
    if (folderName) folderName.innerHTML = 'No folder selected';
    if (folderDiv) folderDiv.classList.remove('is-danger');
}

function isUberFolderUpload(files) {
    if (!files || files.length === 0) return false;
    const first = files[0];
    return files.length > 1 || Boolean(first.webkitRelativePath);
}

async function loadUberUpload(files) {
    if (!files || files.length === 0) throw new Error('No files selected');
    const first = files[0];
    if (!isUberFolderUpload(files) && first.name.toLowerCase().endsWith('.zip')) {
        return JSZip.loadAsync(first);
    }
    if (!isUberFolderUpload(files)) {
        throw new Error('Expected a .zip file or a folder');
    }
    const zip = new JSZip();
    for (const file of files) {
        zip.file(file.webkitRelativePath || file.name, file);
    }
    return zip;
}

function getUberUploadDisplayName(files) {
    if (!files || files.length === 0) return '';
    const first = files[0];
    if (!isUberFolderUpload(files)) return first.name;
    const folderPath = first.webkitRelativePath || '';
    const folderName = folderPath.includes('/') ? folderPath.split('/')[0] : 'Selected folder';
    return `${folderName} (${files.length} files)`;
}

async function handleUberUpload(files, nameElementId, inputDivId) {
    const nameEl = document.getElementById(nameElementId);
    if (nameEl) nameEl.innerHTML = getUberUploadDisplayName(files);
    const fileError = document.getElementById("file-error-message");
    const inputDiv = document.getElementById(inputDivId);
    if (fileError) fileError.classList.remove("is-active");
    if (inputDiv) inputDiv.classList.remove("is-danger");
    try {
        const zipFile = await loadUberUpload(files);
        uberData = await processUberData(zipFile);
        await validateAndProcessData();
    } catch (error) {
        uberData = null;
        if (fileError) fileError.classList.add("is-active");
        if (inputDiv) inputDiv.classList.add("is-danger");
    }
}

function setUberUploadMode(mode) {
    const zipDiv = document.getElementById('uberFileInputDiv');
    const folderDiv = document.getElementById('uberFolderInputDiv');
    if (!zipDiv || !folderDiv) return;
    const isZip = mode === 'zip';
    zipDiv.classList.toggle('hidden', !isZip);
    folderDiv.classList.toggle('hidden', isZip);
    uberData = null;
    resetUberUploadInputs();
    validateAndProcessData();
}

function initUberUploadModeToggle() {
    const uberUploadModeToggle = document.getElementById('uberUploadModeToggle');
    if (!uberUploadModeToggle) return;
    uberUploadModeToggle.addEventListener('change', (event) => {
        if (event.target.name !== 'uberUploadMode') return;
        setUberUploadMode(event.target.value);
    });
    const checkedMode = uberUploadModeToggle.querySelector('input[name="uberUploadMode"]:checked');
    setUberUploadMode(checkedMode ? checkedMode.value : 'zip');
}

// DoorDash: accepts either a .zip file or a folder (same underlying files either way).
function resetDoorDashUploadInputs() {
    const zipInput = document.getElementById('doorDashFileInput');
    const zipName = document.getElementById('doorDashFileName');
    const zipDiv = document.getElementById('doorDashFileInputDiv');
    const folderInput = document.getElementById('doorDashFolderInput');
    const folderName = document.getElementById('doorDashFolderName');
    const folderDiv = document.getElementById('doorDashFolderInputDiv');
    if (zipInput) zipInput.value = '';
    if (zipName) zipName.innerHTML = 'No file selected';
    if (zipDiv) zipDiv.classList.remove('is-danger');
    if (folderInput) folderInput.value = '';
    if (folderName) folderName.innerHTML = 'No folder selected';
    if (folderDiv) folderDiv.classList.remove('is-danger');
}

function isDoorDashFolderUpload(files) {
    if (!files || files.length === 0) return false;
    const first = files[0];
    return files.length > 1 || Boolean(first.webkitRelativePath);
}

async function loadDoorDashUpload(files) {
    if (!files || files.length === 0) throw new Error('No files selected');
    const first = files[0];
    if (!isDoorDashFolderUpload(files) && first.name.toLowerCase().endsWith('.zip')) {
        return JSZip.loadAsync(first);
    }
    if (!isDoorDashFolderUpload(files)) {
        throw new Error('Expected a .zip file or a folder');
    }
    const zip = new JSZip();
    for (const file of files) {
        zip.file(file.webkitRelativePath || file.name, file);
    }
    return zip;
}

function getDoorDashUploadDisplayName(files) {
    if (!files || files.length === 0) return '';
    const first = files[0];
    if (!isDoorDashFolderUpload(files)) return first.name;
    const folderPath = first.webkitRelativePath || '';
    const folderName = folderPath.includes('/') ? folderPath.split('/')[0] : 'Selected folder';
    return `${folderName} (${files.length} files)`;
}

async function handleDoorDashUpload(files, nameElementId, inputDivId) {
    const nameEl = document.getElementById(nameElementId);
    if (nameEl) nameEl.innerHTML = getDoorDashUploadDisplayName(files);
    const fileError = document.getElementById("file-error-message");
    const inputDiv = document.getElementById(inputDivId);
    if (fileError) fileError.classList.remove("is-active");
    if (inputDiv) inputDiv.classList.remove("is-danger");
    try {
        const zipFile = await loadDoorDashUpload(files);
        doordashData = await processDoorDashData(zipFile);
        await validateAndProcessData();
    } catch (error) {
        doordashData = null;
        if (fileError) fileError.classList.add("is-active");
        if (inputDiv) inputDiv.classList.add("is-danger");
    }
}

function setDoorDashUploadMode(mode) {
    const zipDiv = document.getElementById('doorDashFileInputDiv');
    const folderDiv = document.getElementById('doorDashFolderInputDiv');
    if (!zipDiv || !folderDiv) return;
    const isZip = mode === 'zip';
    zipDiv.classList.toggle('hidden', !isZip);
    folderDiv.classList.toggle('hidden', isZip);
    doordashData = null;
    resetDoorDashUploadInputs();
    validateAndProcessData();
}

function initDoorDashUploadModeToggle() {
    const doorDashUploadModeToggle = document.getElementById('doorDashUploadModeToggle');
    if (!doorDashUploadModeToggle) return;
    doorDashUploadModeToggle.addEventListener('change', (event) => {
        if (event.target.name !== 'doorDashUploadMode') return;
        setDoorDashUploadMode(event.target.value);
    });
    const checkedMode = doorDashUploadModeToggle.querySelector('input[name="doorDashUploadMode"]:checked');
    setDoorDashUploadMode(checkedMode ? checkedMode.value : 'zip');
}

// Uber Input
const uberFileInput = document.getElementById('uberFileInput');
if (uberFileInput) {
    uberFileInput.addEventListener('change', async event => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        await handleUberUpload(files, 'uberFileName', 'uberFileInputDiv');
    });
}

const uberFolderInput = document.getElementById('uberFolderInput');
if (uberFolderInput) {
    uberFolderInput.addEventListener('change', async event => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        await handleUberUpload(files, 'uberFolderName', 'uberFolderInputDiv');
    });
}

// Lyft Input
const lyftFileInput = document.getElementById('lyftFileInput');
if (lyftFileInput) {
    lyftFileInput.addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        document.getElementById("lyftFileName").innerHTML = file.name;
        try {
            const zipFile = await JSZip.loadAsync(file);
            lyftData = await processLyftData(zipFile);
            await validateAndProcessData();
        } catch (error) {
            lyftData = null;
            document.getElementById("file-error-message").classList.add("is-active");
            document.getElementById("lyftFileInputDiv").classList.add("is-danger");
        }
    });
}

// DoorDash Input
const doorDashFileInput = document.getElementById('doorDashFileInput');
if (doorDashFileInput) {
    doorDashFileInput.addEventListener('change', async event => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        await handleDoorDashUpload(files, 'doorDashFileName', 'doorDashFileInputDiv');
    });
}

const doorDashFolderInput = document.getElementById('doorDashFolderInput');
if (doorDashFolderInput) {
    doorDashFolderInput.addEventListener('change', async event => {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        await handleDoorDashUpload(files, 'doorDashFolderName', 'doorDashFolderInputDiv');
    });
}

// Grubhub Input
const grubhubFileInput = document.getElementById('grubhubFileInput');
if (grubhubFileInput) {
    grubhubFileInput.addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        document.getElementById("grubhubFileName").innerHTML = file.name;
        try {
            grubhubData = await processGrubhubUpload(file);
            await validateAndProcessData();
        } catch (error) {
            grubhubData = null;
            document.getElementById("file-error-message").classList.add("is-active");
            document.getElementById("grubhubFileInputDiv").classList.add("is-danger");
        }
    });
}

// Instacart Orders Input
const instacartOrdersFileInput = document.getElementById('instacartOrdersFileInput');
if (instacartOrdersFileInput) {
    instacartOrdersFileInput.addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        document.getElementById("instacartOrdersFileName").innerHTML = file.name;
        try {
            const csvText = await file.text();
            instacartData.orders = processInstacartOrdersCSV(csvText);
            await validateAndProcessData();
        } catch (error) {
            instacartData.orders = [];
            document.getElementById("file-error-message").classList.add("is-active");
            document.getElementById("instacartOrdersFileInputDiv").classList.add("is-danger");
        }
    });
}

// Instacart Deliveries Input
const instacartDeliveriesFileInput = document.getElementById('instacartDeliveriesFileInput');
if (instacartDeliveriesFileInput) {
    instacartDeliveriesFileInput.addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        document.getElementById("instacartDeliveriesFileName").innerHTML = file.name;
        try {
            const csvText = await file.text();
            instacartData.deliveries = processInstacartDeliveriesCSV(csvText);
            await validateAndProcessData();
        } catch (error) {
            instacartData.deliveries = [];
            document.getElementById("file-error-message").classList.add("is-active");
            document.getElementById("instacartDeliveriesFileInputDiv").classList.add("is-danger");
        }
    });
}


document.getElementById('submitZipButton').onclick = async (event) => {
    const btn = event.target;
    btn.classList.add("is-loading");
    document.getElementById('submit-error').classList.add("hidden");
    
    if (!rideshareDataEntered) return;

    try {
        const pid = getProlificId();

        // Delivery upload: optional gate from www/delivery/receipts_hub.js (forwarding or receipts .zip uploaded)
        if (typeof window.hubEmailReceiptsGate === "function" && !window.hubEmailReceiptsGate()) {
            const submitError = document.getElementById("submit-error");
            if (submitError) {
                submitError.textContent =
                    window.hubEmailReceiptsGateErrorText ||
                    "Please complete the email receipts step before submitting.";
                submitError.classList.remove("hidden");
            }
            btn.classList.remove("is-loading");
            return;
        }

        // 1. Request Signed URL (S3 Key: PID/ride_data.json)
        const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const fileName = `ride_data_${uniqueSuffix}.json`;
        
        const uploadTag = document.body ? document.body.dataset.uploadTag : "";
        const studyType = document.body ? document.body.dataset.studyType : "";
        const signedPayload = { pid: pid, fileName };
        if (uploadTag) {
            signedPayload.tag = uploadTag;
        }
        if (studyType) {
            signedPayload.studyType = studyType;
        }

        const signedRes = await fetch(LAMBDA_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(signedPayload)
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
        const submitContainer = document.getElementById('submitZipButton').parentElement;
        let successMsg = submitContainer ? submitContainer.querySelector('.zip-upload-success') : null;
        if (!successMsg && submitContainer) {
            successMsg = document.createElement('div');
            successMsg.className = 'notification is-success zip-upload-success';
            successMsg.style.marginTop = '1rem';
            successMsg.innerHTML = `
                <h4 class="title is-5">Upload Complete!</h4>
                <p style="margin-bottom: 1rem;">Your ride data has been securely uploaded.</p>
            `;
            const submitError = document.getElementById('submit-error');
            if (submitError && submitError.parentElement === submitContainer) {
                submitContainer.insertBefore(successMsg, submitError.nextSibling);
            } else {
                submitContainer.insertBefore(successMsg, document.getElementById('submitZipButton'));
            }
        }

        // Data-only rideshare flow: route directly to Qualtrics after successful upload
        if (uploadTag === "dataonly") {
            window.location.href = buildQualtricsUrl("https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_8HbhWLqxBT6I0Qu");
            return;
        }
        // ETA capture flow
        if (uploadTag === "uber_eta_capture") {
            window.location.href = buildQualtricsUrl("https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_abBB0VYZjyvDuiq");
            return;
        }
        // Delivery upload flow: route to delivery-specific Qualtrics after successful upload
        if (uploadTag === "delivery") {
            window.location.href = buildQualtricsUrl("https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_6GdeWEOSM2N84B0");
            return;
        }
        
    } catch (err) {
        console.error(err);
        document.getElementById('submit-error').classList.remove("hidden");
    } finally {
        btn.classList.remove("is-loading");
    }
};


// Initialize upload flow on page load
window.addEventListener('DOMContentLoaded', () => {
    initUberUploadModeToggle();
    initDoorDashUploadModeToggle();

    // Check if email is in URL (from consent form or return participant)
    const urlParams = new URLSearchParams(window.location.search);
    const emailFromURL = urlParams.get('email');
    const participantIdFromURL = urlParams.get('participantId'); // Backward compatibility
    const prolificIdFromURL = urlParams.get('ProlificID'); // Backward compatibility
    const emailFromSession = sessionStorage.getItem('email');
    const participantIdFromSession = sessionStorage.getItem('participantId'); // Backward compatibility
    
    const email = emailFromURL || participantIdFromURL || prolificIdFromURL || emailFromSession || participantIdFromSession;
    
    if (email) {
        // Show upload sections
        const uploadSections = document.getElementById('uploadSections');
        if (uploadSections) uploadSections.style.display = 'block';
        
        // Hide return participant section
        const returnSection = document.getElementById('returnParticipantSection');
        if (returnSection) returnSection.style.display = 'none';
        
        // Set email in inputs (try new email inputs first, then fall back to old IDs)
        const zipEmailInput = document.getElementById('emailInput');
        const zipPidInput = document.getElementById('prolificIdInput');
        
        if (zipEmailInput) zipEmailInput.value = email;
        else if (zipPidInput) zipPidInput.value = email;
        
        // Initialize functionality
        validateAndProcessData();
    } else {
        // No email - show return participant section or redirect to consent
        const returnSection = document.getElementById('returnParticipantSection');
        if (returnSection) returnSection.style.display = 'block';
        
        // Hide upload sections
        const uploadSections = document.getElementById('uploadSections');
        if (uploadSections) uploadSections.style.display = 'none';
        
        // Handle return email entry
        const continueWithEmailButton = document.getElementById('continueWithEmailButton');
        const returnEmailInput = document.getElementById('returnEmailInput');
        // Backward compatibility
        const continueWithIdButton = document.getElementById('continueWithIdButton');
        const returnParticipantIdInput = document.getElementById('returnParticipantIdInput');
        
        const continueButton = continueWithEmailButton || continueWithIdButton;
        const returnInput = returnEmailInput || returnParticipantIdInput;
        
        if (continueButton && returnInput) {
            continueButton.addEventListener('click', () => {
                const enteredEmail = returnInput.value.trim();
                if (enteredEmail) {
                    // Set the email in the upload input
                    const zipEmailInput = document.getElementById('emailInput');
                    const zipPidInput = document.getElementById('prolificIdInput');
                    
                    if (zipEmailInput) zipEmailInput.value = enteredEmail;
                    else if (zipPidInput) zipPidInput.value = enteredEmail;
                    
                    // Store in session
                    sessionStorage.setItem('email', enteredEmail);
                    sessionStorage.setItem('participantId', enteredEmail); // Backward compatibility
                    
                    // Show upload sections
                    const uploadSections = document.getElementById('uploadSections');
                    if (uploadSections) uploadSections.style.display = 'block';
                    
                    // Hide return section
                    if (returnSection) returnSection.style.display = 'none';
                    
                    // Initialize functionality
                    validateAndProcessData();
                }
            });
            
            // Also allow Enter key
            returnInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    continueButton.click();
                }
            });
        }
    }
});
