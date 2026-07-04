/**
 * Example Emerald plugin.
 *
 * To activate: copy this folder into `plugins/` at the repo root
 * (creating it if needed) and restart the server:
 *
 *   mkdir -p plugins && cp -r examples/plugins/hello-world plugins/
 *
 * A plugin is any folder containing an `index.mjs` whose default export
 * receives the plugin API. See docs/PLUGINS.md for the full API.
 */
export default function register(api) {
  // 1. Add an HTTP endpoint: GET /api/plugins/hello-world/greet?name=You
  api.addRoute('/greet', (req, res) => {
    res.json({ message: `Hello, ${req.query.name ?? 'world'} — from a plugin!` });
  });

  // 2. Register a command that shows up in the client's command registry.
  api.addCommand({
    id: 'hello-world.greet',
    title: 'Hello World: Greet',
    description: 'Demonstrates a plugin-contributed command',
  });

  api.log('hello-world plugin loaded');
}
