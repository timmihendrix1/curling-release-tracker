import type { Metadata } from "next";
import PrivacyNotice from "../../../../components/legal/PrivacyNotice";

export const metadata: Metadata = {
  title: "Privacy Notice | Curling Performance",
  description: "How Evolane Curling handles personal data in Curling Performance.",
};

export default function VersionedPrivacyNoticePage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 sm:px-6 sm:py-10">
      <PrivacyNotice />
    </main>
  );
}
