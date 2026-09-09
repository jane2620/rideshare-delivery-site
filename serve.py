#!/usr/bin/env python3
"""
Local development server for the search engine use study website.
Serves static files from the project root directory.
"""

import http.server
import socketserver
import os
import sys
import webbrowser
from urllib.parse import urlparse

PORT = 8000

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Custom request handler that serves files with proper MIME types."""
    
    def end_headers(self):
        # Add CORS headers for local development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def log_message(self, format, *args):
        """Override to provide cleaner log output."""
        # Only log actual requests, not favicon requests
        # if 'favicon' not in args[0]:
        #     super().log_message(format, *args)
        pass

def find_available_port(start_port=8000, max_attempts=10):
    """Find an available port starting from start_port."""
    import socket
    for port in range(start_port, start_port + max_attempts):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('', port))
                return port
        except OSError:
            continue
    return start_port

def main():
    """Start the local development server."""
    global PORT
    
    # Parse command line arguments
    if len(sys.argv) > 1:
        try:
            PORT = int(sys.argv[1])
        except ValueError:
            print(f"Invalid port number: {sys.argv[1]}")
            print("Usage: python serve.py [port]")
            sys.exit(1)
    
    # Find available port if specified port is in use
    PORT = find_available_port(PORT)
    
    # Change to the script's directory (project root)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
    # Create server
    handler = CustomHTTPRequestHandler
    
    try:
        with socketserver.TCPServer(("", PORT), handler) as httpd:
            server_url = f"http://localhost:{PORT}"
            
            print("=" * 60)
            print("Local Development Server Started")
            print("=" * 60)
            print(f"\nServer running at: {server_url}")
            print(f"Serving from: {script_dir}")
            print("\nAvailable pages:")
            print(f"   • Desktop: {server_url}/desktop/index.html")
            print(f"   • Desktop Rideshare: {server_url}/desktop/rideshare_index.html")
            print(f"   • Mobile: {server_url}/mobile/index.html")
            print(f"   • Redirect: {server_url}/redirect/index.html")
            print(f"   • Shortcut: {server_url}/shortcut/index.html")
            print("\nTip: Add URL parameters for testing:")
            print(f"   {server_url}/desktop/rideshare_index.html?PROLIFIC_PID=test123&LYFT_USER=1&UBER_USER=1")
            print("\nPress Ctrl+C to stop the server")
            print("=" * 60)
            
            # Try to open browser automatically
            try:
                webbrowser.open(f"{server_url}/desktop/rideshare_index.html")
            except:
                pass
            
            # Start serving
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n\nServer stopped by user")
        sys.exit(0)
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"\nError: Port {PORT} is already in use.")
            print(f"Try a different port: python serve.py {PORT + 1}")
        else:
            print(f"\nError: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

