export const TERMS_OF_SERVICE_VERSION = "terms-2026-08-29";
export const TERMS_OF_SERVICE_EFFECTIVE_DATE = "29 August 2026";
export const TERMS_OF_SERVICE_CANONICAL_PATH = "/legal/terms/2026-08-29";

const sectionClassName = "space-y-3";
const headingClassName = "text-xl font-semibold text-slate-900";
const listClassName = "list-disc space-y-2 pl-5 text-slate-700";

export default function TermsOfService() {
  return (
    <article className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-5 shadow-lg sm:p-8">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-sm font-medium text-slate-500">Curling Performance</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
          Terms of Service
        </h1>
        <dl className="mt-4 grid gap-1 text-sm text-slate-600 sm:grid-cols-[8rem_1fr]">
          <dt className="font-medium text-slate-700">Version</dt>
          <dd>{TERMS_OF_SERVICE_VERSION}</dd>
          <dt className="font-medium text-slate-700">Effective date</dt>
          <dd>{TERMS_OF_SERVICE_EFFECTIVE_DATE}</dd>
        </dl>
        <p className="mt-4 text-slate-700">
          These Terms govern your use of the closed-beta Curling Performance web app
          provided by Evolane Curling. By creating your athlete profile, you agree to
          this version of the Terms.
        </p>
      </header>

      <div className="mt-7 space-y-8">
        <section className={sectionClassName} aria-labelledby="terms-operator">
          <h2 id="terms-operator" className={headingClassName}>1. Operator and contact</h2>
          <p className="text-slate-700">
            The service is operated by <strong>Evolane Curling</strong>. Questions about
            these Terms or the closed beta can be sent to{" "}
            <a
              className="font-medium text-slate-900 underline underline-offset-4"
              href="mailto:info@evolane.swiss"
            >
              info@evolane.swiss
            </a>
            .
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-service">
          <h2 id="terms-service" className={headingClassName}>2. The closed-beta service</h2>
          <p className="text-slate-700">
            Curling Performance helps athletes record release timing, complete curated
            exercises, follow personal Training Plans and participate in Team training.
            The current closed beta is provided without charge and does not create a paid
            subscription.
          </p>
          <p className="text-slate-700">
            This is test software. Features may be incomplete, change during the beta or
            occasionally be unavailable. We will not silently turn the free closed beta
            into a paid service; any future paid offer will require separate, clear terms.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-account">
          <h2 id="terms-account" className={headingClassName}>3. Your account</h2>
          <ul className={listClassName}>
            <li>Provide accurate account and Profile information and keep it reasonably current.</li>
            <li>Use only your own sign-in method and do not share authentication codes or access.</li>
            <li>Tell us promptly if you believe your account or a Team has been accessed improperly.</li>
            <li>Use the service only where you are permitted to agree to and follow these Terms.</li>
          </ul>
          <p className="text-slate-700">
            You are responsible for activity performed through your account unless it
            resulted from a security failure for which Evolane Curling is responsible.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-use">
          <h2 id="terms-use" className={headingClassName}>4. Acceptable use</h2>
          <p className="text-slate-700">You must not:</p>
          <ul className={listClassName}>
            <li>use the service unlawfully, fraudulently or to harm, harass or impersonate another person;</li>
            <li>access another athlete&apos;s information without permission or bypass access controls;</li>
            <li>submit malicious code, disrupt the service or probe it for vulnerabilities without written authorisation;</li>
            <li>misrepresent training results, another person&apos;s role or who recorded or corrected data;</li>
            <li>upload or record content you do not have the right to use; or</li>
            <li>copy, extract or redistribute restricted exercise assets contrary to their displayed source restrictions.</li>
          </ul>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-team">
          <h2 id="terms-team" className={headingClassName}>5. Team training and recording</h2>
          <p className="text-slate-700">
            Team features allow authorised participants, including athletes and coaches,
            to record shared training context and individual athlete results. Record only
            information relevant to the training, respect each athlete&apos;s recording
            permission and use Team access solely for the Team purpose for which it was
            granted.
          </p>
          <p className="text-slate-700">
            Training values can contain mistakes. The app identifies recorders and keeps
            correction or voiding information where supported, but each Team remains
            responsible for interpreting its own observations and resolving sporting
            disagreements fairly.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-content">
          <h2 id="terms-content" className={headingClassName}>6. Your content and data</h2>
          <p className="text-slate-700">
            You keep any rights you hold in notes and other content you enter. You give
            Evolane Curling a non-exclusive permission to host, copy, process and display
            that content only as needed to operate, secure and improve the service and to
            provide the Team features you choose to use. This permission ends when the
            content is deleted, except where limited retention is required for security,
            legal obligations, dispute handling or the documented audit and sync safeguards
            described in the Privacy Notice.
          </p>
          <p className="text-slate-700">
            You are responsible for having the necessary rights and permissions for content
            you enter about another person.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-platform-content">
          <h2 id="terms-platform-content" className={headingClassName}>7. Platform and source material</h2>
          <p className="text-slate-700">
            The app, its independently created software, interface and original content are
            protected by applicable intellectual-property law. These Terms give you a
            limited, personal, non-transferable right to use the service for its intended
            training purpose during the beta; they do not transfer ownership to you.
          </p>
          <p className="text-slate-700">
            Some curated exercise material is attributed to Swiss Curling and is available
            only to the authorised closed-beta Team. Its source attribution and delivery
            restrictions remain visible. Access through the app does not grant permission
            to publish or redistribute that material outside the authorised test.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-safety">
          <h2 id="terms-safety" className={headingClassName}>8. Training safety and performance information</h2>
          <p className="text-slate-700">
            Curling is a physical activity. Follow rink rules, use suitable equipment and
            stop if conditions are unsafe. The app does not replace qualified coaching,
            medical advice or your own judgement. Timing values, scores and summaries are
            training information, not a promise of sporting performance or injury prevention.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-availability">
          <h2 id="terms-availability" className={headingClassName}>9. Availability and ending access</h2>
          <p className="text-slate-700">
            You may stop using the service at any time. You can contact us to request account
            closure or exercise applicable data rights. Evolane Curling may restrict or end
            access when reasonably necessary to protect users or the service, respond to a
            legal requirement, address a serious breach of these Terms or end the closed beta.
            Where practical, we will provide notice and a reasonable opportunity to export
            available personal training history before a planned beta shutdown.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-warranty">
          <h2 id="terms-warranty" className={headingClassName}>10. Warranty and liability</h2>
          <p className="text-slate-700">
            We will use reasonable care in operating the service, but the beta is provided
            on an as-available basis and may contain defects. To the extent permitted by
            mandatory law, Evolane Curling is not liable for indirect or consequential loss,
            loss of opportunity, or loss caused by inaccurate user-entered training data,
            rink conditions, third-party services or use contrary to these Terms.
          </p>
          <p className="text-slate-700">
            Nothing in these Terms excludes or limits liability that cannot lawfully be
            excluded or limited, including liability for intentional misconduct or gross
            negligence. Your mandatory consumer rights remain unaffected.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-privacy">
          <h2 id="terms-privacy" className={headingClassName}>11. Privacy</h2>
          <p className="text-slate-700">
            The{" "}
            <a
              className="font-medium text-slate-900 underline underline-offset-4"
              href="/privacy"
            >
              Privacy Notice
            </a>{" "}
            explains how Evolane Curling handles personal data. Accepting these Terms and
            acknowledging the Privacy Notice are separate onboarding actions.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-changes">
          <h2 id="terms-changes" className={headingClassName}>12. Changes to these Terms</h2>
          <p className="text-slate-700">
            We may publish a new version as the service changes. The version and effective
            date at the top identify these Terms. Publishing a new version does not silently
            replace the version you accepted. If a future version is to govern continued
            use, it must be presented through a separately implemented acceptance process.
            A correction to an accepted version is issued as a new version rather than
            silently editing the accepted text.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="terms-law">
          <h2 id="terms-law" className={headingClassName}>13. Applicable law</h2>
          <p className="text-slate-700">
            These Terms are governed by Swiss law, subject to any mandatory consumer
            protection or other rights that apply to you. The competent courts are
            determined by applicable law.
          </p>
        </section>
      </div>
    </article>
  );
}
