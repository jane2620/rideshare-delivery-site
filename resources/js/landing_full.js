// landing_full.js

window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const email = urlParams.get('email');
    const participantId = urlParams.get('participantId'); // Backward compatibility
    
    const emailValue = email || participantId;
    
    if (emailValue) {
        // Store in sessionStorage
        sessionStorage.setItem('email', emailValue);
        sessionStorage.setItem('participantId', emailValue); // Backward compatibility
    }
    
    // Handle upload data button
    const uploadDataButton = document.getElementById('uploadDataButton');
    if (uploadDataButton) {
        uploadDataButton.addEventListener('click', () => {
            // Check if email exists in sessionStorage or URL
            const urlParams = new URLSearchParams(window.location.search);
            const emailFromURL = urlParams.get('email');
            const participantIdFromURL = urlParams.get('participantId'); // Backward compatibility
            const emailFromSession = sessionStorage.getItem('email');
            const participantIdFromSession = sessionStorage.getItem('participantId'); // Backward compatibility
            
            const emailValue = emailFromURL || participantIdFromURL || emailFromSession || participantIdFromSession;
            
            if (emailValue) {
                // Redirect to upload page with email
                window.location.href = `/study/upload.html?email=${encodeURIComponent(emailValue)}`;
            } else {
                // No email - redirect to upload page where they can enter it
                window.location.href = `/study/upload.html`;
            }
        });
    }
});

