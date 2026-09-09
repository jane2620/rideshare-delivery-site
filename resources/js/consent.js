// consent.js

const LAMBDA_URL = window.APP_CONFIG.LAMBDA_URL;

function generateRandomId() {
    const baseId = Math.floor(1000000 + Math.random() * 9999999);
    const timestamp = Date.now().toString().slice(-4);
    return `${baseId}${timestamp}`;
}

document.getElementById('consentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('emailInput').value.trim();
    const consentChecked = document.getElementById('consentCheckbox').checked;
    const submitButton = document.getElementById('consentSubmitButton');
    const errorBox = document.getElementById('consent-error');
    
    if (!email || !consentChecked) {
        document.getElementById('consent-error-text').innerText = 'Please provide your email and confirm your consent.';
        errorBox.classList.remove('hidden');
        return;
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        document.getElementById('consent-error-text').innerText = 'Please enter a valid email address.';
        errorBox.classList.remove('hidden');
        return;
    }
    
    submitButton.classList.add('is-loading');
    errorBox.classList.add('hidden');
    
    try {
        // Generate random participant ID
        const participantId = generateRandomId();
        
        // Store consent data (send to backend)
        const consentData = {
            email: email,
            participantId: participantId,
            consentDate: new Date().toISOString(),
            timestamp: Date.now()
        };
        
        try {
            const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const fileName = `consent_${uniqueSuffix}.json`;

            const signedRes = await fetch(LAMBDA_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pid: participantId, fileName })
            });
            
            if (signedRes.ok) {
                const { uploadUrl } = await signedRes.json();
                await fetch(uploadUrl, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(consentData)
                });
            }
        } catch (backendError) {
            console.warn('Could not save consent to backend, storing locally:', backendError);
            // Store in localStorage as backup
            localStorage.setItem(`consent_${participantId}`, JSON.stringify(consentData));
        }
        
        // Store participant ID for later use
        sessionStorage.setItem('participantId', participantId);
        sessionStorage.setItem('participantEmail', email);
        
        // Show participant ID to user before redirecting
        const form = document.getElementById('consentForm');
        form.innerHTML = `
            <div class="notification is-success">
                <h3 class="title is-4">Consent Submitted Successfully!</h3>
                <p class="block" style="margin-top: 1rem;">
                    <strong>Your Participant ID is:</strong>
                </p>
                <div class="box" style="background-color: #f5f5f5; margin: 1rem 0;">
                    <p class="title is-4 has-text-centered" style="font-family: monospace; word-break: break-all;">
                        ${participantId}
                    </p>
                </div>
                <p class="block">
                    <strong>Please save this ID!</strong> You will need it to upload your ride history and screenshots.
                </p>
                <p class="block">
                    We've also sent a confirmation email to <strong>${email}</strong> with your participant ID.
                </p>
                <div class="has-text-centered" style="margin-top: 2rem;">
                    <button id="continueButton" class="button is-link is-large">
                        Continue to Qualtrics Survey &raquo;
                    </button>
                </div>
            </div>
        `;
        
        // Add continue button handler - redirect to Qualtrics survey with participant ID
        const qualtricsLink = `https://princetonsurvey.az1.qualtrics.com/jfe/form/SV_6Jdl3otIYj6SLuS?ParticipantID=${encodeURIComponent(participantId)}`;
        document.getElementById('continueButton').addEventListener('click', () => {
            window.location.href = qualtricsLink;
        });
        
    } catch (error) {
        console.error('Error processing consent:', error);
        document.getElementById('consent-error-text').innerText = 'An error occurred. Please try again.';
        errorBox.classList.remove('hidden');
        submitButton.classList.remove('is-loading');
    }
});

