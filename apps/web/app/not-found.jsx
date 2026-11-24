import Link from 'next/link';

export default function NotFound(){
  return <main id="main" className="main">
    <section className="panel">
      <h1>This page is unavailable.</h1>
      <p>It may have moved, been removed, or be unavailable to your account.</p>
      <div className="button-row">
        <Link href="/" className="primary-link">Go home</Link>
        <Link href="/search" className="secondary-link">Explore lessons</Link>
      </div>
    </section>
  </main>;
}
