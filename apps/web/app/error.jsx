'use client';
import Link from 'next/link';

export default function RouteError({reset}) {
  return <main id="main" className="main">
    <section className="panel">
      <h1>We couldn't open this page.</h1>
      <p role="alert">Something went wrong. Check your connection and try again.</p>
      <div className="button-row">
        <button type="button" className="primary-link" onClick={() => reset()}>Try again</button>
        <Link href="/" className="secondary-link">Go home</Link>
      </div>
    </section>
  </main>;
}
