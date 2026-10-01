import Navbar from "./Navbar";
import Hero from "./Hero";
import Footer from "./Footer";

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col bg-zinc-950 text-zinc-100 grow">
      <Navbar />
      <main className="flex-1">
        <Hero />
      </main>
      <Footer />
    </div>
  );
}
