import Link from "next/link";

export default function NotFound() {
  return (
    <main className="center-page" id="main">
      <div className="auth-card">
        <div className="brandmark"><i>O</i><div><b>Outgrow Console</b><small>Acsia · EXPAND</small></div></div>
        <h1>Page not found</h1>
        <p>That page doesn't exist, or it isn't part of your view.</p>
        <Link className="btn acc block" href="/">Go to my home screen</Link>
      </div>
    </main>
  );
}
