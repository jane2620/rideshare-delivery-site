// load-phase-blocks.js
// Utility to load and insert phase blocks HTML into a container

async function loadPhaseBlocks(containerId) {
    try {
        const response = await fetch('/study/phase-blocks.html');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const html = await response.text();
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = html;
        } else {
            console.error(`Container with id "${containerId}" not found`);
        }
    } catch (error) {
        console.error('Error loading phase blocks:', error);
    }
}

// Auto-load when DOM is ready if container exists
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('phase-blocks-container');
    if (container) {
        loadPhaseBlocks('phase-blocks-container');
    }
});

