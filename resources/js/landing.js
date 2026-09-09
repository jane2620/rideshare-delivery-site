// landing.js

window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const participantId = urlParams.get('participantId');
    
    if (participantId) {
        // Store in sessionStorage
        sessionStorage.setItem('participantId', participantId);
    }
    
    // Handle upload data button
    const uploadDataButton = document.getElementById('uploadDataButton');
    if (uploadDataButton) {
        uploadDataButton.addEventListener('click', () => {
            // Check if participant ID exists in sessionStorage or URL
            const urlParams = new URLSearchParams(window.location.search);
            const participantIdFromURL = urlParams.get('participantId');
            const participantIdFromSession = sessionStorage.getItem('participantId');
            
            if (participantIdFromURL || participantIdFromSession) {
                // Redirect to upload page with participant ID
                const participantId = participantIdFromURL || participantIdFromSession;
                window.location.href = `/web/upload.html?participantId=${encodeURIComponent(participantId)}`;
            } else {
                // No participant ID - redirect to upload page where they can enter it
                window.location.href = `/web/landing.html`;
            }
        });
    }
});

