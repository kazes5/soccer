import Link from 'next/link';

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-16 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Soccer Carpool Coordinator</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Coordinate practice pickups and drop-offs without the group-chat chaos.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href="/login"
          className="rounded-md bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-700"
        >
          Log in
        </Link>
        <Link
          href="/teams/new"
          className="rounded-md border border-zinc-300 px-5 py-2.5 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Create a new team
        </Link>
      </div>
    </main>
  );
}
