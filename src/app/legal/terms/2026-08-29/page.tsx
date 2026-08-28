import type { Metadata } from "next";
import TermsOfService from "../../../../components/legal/TermsOfService";

export const metadata: Metadata = {
  title: "Terms of Service | Curling Performance",
  description: "Terms for the Curling Performance closed beta provided by Evolane Curling.",
};

export default function VersionedTermsOfServicePage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 sm:py-10">
      <TermsOfService />
    </main>
  );
}
