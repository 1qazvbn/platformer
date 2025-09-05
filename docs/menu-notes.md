Entry point: index.html loads game scripts via dynamic script tags. No bundler; plain browser script loader.

The new main menu module is loaded on startup without statically importing level code. Levels load only after selection through URL and localStorage flags.
