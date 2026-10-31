// Builds kursvagt/index.html from src/ (run: node kursvagt/build.mjs). The GitHub Action also runs it before deploying.
import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const dir = path.dirname(fileURLToPath(import.meta.url)), src = (f) => fs.readFileSync(path.join(dir, "src", f), "utf8");
const head = '<!doctype html>\n<html lang="da">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
  '<meta name="theme-color" content="#2b333d">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Kursvagt">\n' +
  '<link rel="manifest" href="manifest.json">\n<link rel="icon" href="icon.svg">\n<link rel="apple-touch-icon" href="icon.svg">\n';
const html = head + src("page.css") + "\n</head>\n<body>\n" + src("body.html") + "\n<script>" + src("shim.js") + '</script>\n<script id="engine">' + src("engine.js") + "</script>\n<script>" + src("app.js") + "</script>\n</body>\n</html>\n";
fs.writeFileSync(path.join(dir, "index.html"), html);
console.log("kursvagt/index.html", html.length, "bytes");
