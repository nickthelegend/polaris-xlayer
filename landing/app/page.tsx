import { Nav, Footer, APPS, PROGRAM_ID } from "./components/Chrome";
import { Hall } from "./components/Board";

export default function Home() {
  return (
    <>
      <Nav />
      <Hall />
      <Footer />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "Polaris Pay",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Web, Android",
            description:
              "A payments layer with credit built in. Pay in full, subscribe, or split into four against a line read from your wallet's own record.",
            url: "https://polarispay.app",
            sameAs: [APPS.github, APPS.docs],
            identifier: PROGRAM_ID,
          }),
        }}
      />
    </>
  );
}
