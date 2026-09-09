/* PLACEHOLDER.
 *
 * Replace this entire file with the real `component-readiness-check.jsx`.
 * No edits to that file are needed: it already imports React and has a
 * default export, which is exactly what this project expects.
 *
 * The rest of the app imports only the default export, so nothing else
 * has to change when you swap it in.
 */

export default function ComponentReadinessCheck() {
  return (
    <div className="crc-placeholder">
      <style>{PLACEHOLDER_CSS}</style>
      <h1>PP Readiness</h1>
      <p className="lead">
        The project scaffold is in place, but the readiness component itself
        has not been added yet.
      </p>
      <ol>
        <li>
          Copy <code>component-readiness-check.jsx</code> over{" "}
          <code>src/components/ComponentReadinessCheck.jsx</code>.
        </li>
        <li>
          Run <code>npm install</code>, then <code>npm run dev</code>.
        </li>
      </ol>
      <p className="note">
        No Node toolchain on this machine? Run{" "}
        <code>tools/build-standalone.ps1</code> instead — it compiles the
        component into a single self-contained HTML file that opens straight
        in a browser.
      </p>
    </div>
  );
}

const PLACEHOLDER_CSS = `
.crc-placeholder{
  max-width: 46rem;
  margin: 0 auto;
  padding: 4rem 1.5rem;
  line-height: 1.6;
}
.crc-placeholder h1{
  font-size: 1.5rem;
  margin: 0 0 .5rem;
  letter-spacing: -0.01em;
}
.crc-placeholder .lead{ color:#52646F; margin:0 0 1.5rem; }
.crc-placeholder ol{ padding-left:1.2rem; margin:0 0 1.5rem; }
.crc-placeholder li{ margin-bottom:.5rem; }
.crc-placeholder code{
  background:#fff;
  border:1px solid #CBD5DC;
  border-radius:4px;
  padding:.1em .4em;
  font-family:"IBM Plex Mono", ui-monospace, Consolas, monospace;
  font-size:.875em;
}
.crc-placeholder .note{
  border-left:3px solid #CBD5DC;
  padding-left:1rem;
  color:#52646F;
  font-size:.9375rem;
}
`;
