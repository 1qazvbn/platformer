Entry point is index.html where startup script previously read ?level query or localStorage key to auto-load a level.
Boot now always loads the menu and removes any keys containing "level" from localStorage or sessionStorage.
URL parameters and hashes like ?level=1 or #level=2 are stripped and history.replaceState rewrites the address to the base path.
Levels launch through bootLevel('1'|'2') from the menu; returnToMenu() clears the path and reloads the menu.
