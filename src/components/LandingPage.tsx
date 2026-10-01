import Navbar from "./Navbar";
import Hero from "./Hero";
import Footer from "./Footer";

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-zinc-950 text-zinc-100">
      <Navbar />
      <main className="flex flex-1 flex-col justify-center">
        <Hero />
      </main>
      <Footer />
    </div>
  );
}