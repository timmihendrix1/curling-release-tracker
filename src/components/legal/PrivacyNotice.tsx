export const PRIVACY_NOTICE_VERSION = "privacy-2026-08-28";
export const PRIVACY_NOTICE_EFFECTIVE_DATE = "28 August 2026";
export const PRIVACY_NOTICE_CANONICAL_PATH = "/legal/privacy/2026-08-28";

const sectionClassName = "space-y-3";
const headingClassName = "text-xl font-semibold text-slate-900";
const listClassName = "list-disc space-y-2 pl-5 text-slate-700";

export default function PrivacyNotice() {
  return (
    <article className="mx-auto w-full max-w-3xl rounded-2xl bg-white p-5 shadow-lg sm:p-8">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-sm font-medium text-slate-500">Curling Performance</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
          Privacy Notice
        </h1>
        <dl className="mt-4 grid gap-1 text-sm text-slate-600 sm:grid-cols-[8rem_1fr]">
          <dt className="font-medium text-slate-700">Version</dt>
          <dd>{PRIVACY_NOTICE_VERSION}</dd>
          <dt className="font-medium text-slate-700">Effective date</dt>
          <dd>{PRIVACY_NOTICE_EFFECTIVE_DATE}</dd>
        </dl>
        <p className="mt-4 text-slate-700">
          This notice explains how Evolane Curling handles personal data when you use the
          closed-beta Curling Performance web app. It covers the account, training,
          exercise and Team features currently available in the app.
        </p>
      </header>

      <div className="mt-7 space-y-8">
        <section className={sectionClassName} aria-labelledby="privacy-controller">
          <h2 id="privacy-controller" className={headingClassName}>1. Who is responsible</h2>
          <p className="text-slate-700">
            The controller is <strong>Evolane Curling</strong>. For privacy questions or
            requests, email{" "}
            <a
              className="font-medium text-slate-900 underline underline-offset-4"
              href="mailto:info@evolane.swiss"
            >
              info@evolane.swiss
            </a>
            .
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="privacy-data">
          <h2 id="privacy-data" className={headingClassName}>2. Data we handle</h2>
          <ul className={listClassName}>
            <li>
              <strong>Account and Profile data:</strong> email address, authentication and
              Profile identifiers, sign-in provider, display name, account entitlement,
              onboarding status and the Legal-document versions you acknowledged or accepted.
            </li>
            <li>
              <strong>Training and performance data:</strong> training sessions, release
              times, targets, shot outcomes, measurements, exercises, training plans,
              assessments, results and notes you choose to record.
            </li>
            <li>
              <strong>Team and collaboration data:</strong> Team names, memberships and
              functions, invitations, administration requests, attendance, athlete and
              recorder attribution, playing roles, Sweeper and Skip context, result
              corrections, acknowledgements and related notifications.
            </li>
            <li>
              <strong>Technical data:</strong> trusted-device and sign-in state, locally
              cached drafts and offline queues, sync status, record identifiers and
              timestamps, plus IP address, device, browser and security-log information
              that our hosting and authentication providers process when delivering the app.
            </li>
          </ul>
          <p className="text-slate-700">
            Most data comes directly from you. In a Team training, another participating
            athlete or coach may record or correct your result and role information, with
            their identity kept as attribution. If you use Google sign-in, Google supplies
            the account information needed to authenticate you.
          </p>
          <p className="text-slate-700">
            The current closed beta does not collect video or sensor data and does not use
            personal data for advertising or behavioural advertising profiles.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="privacy-purpose">
          <h2 id="privacy-purpose" className={headingClassName}>3. Why we use it</h2>
          <p className="text-slate-700">We use personal data to:</p>
          <ul className={listClassName}>
            <li>create and secure your account and keep the app available offline where supported;</li>
            <li>store, sync, display and export your training and performance records;</li>
            <li>run Team training and the collaboration features you choose to use;</li>
            <li>calculate the app&apos;s training feedback and factual performance summaries;</li>
            <li>send necessary account, invitation and Team-administration messages;</li>
            <li>operate, protect, troubleshoot and improve the closed beta; and</li>
            <li>keep necessary evidence, audit records and deletion safeguards.</li>
          </ul>
          <p className="text-slate-700">
            Where EU or EEA data-protection law applies, these activities rely on taking
            steps at your request and providing the service, our legitimate interests in
            operating and securing the beta, and compliance with legal obligations. If a
            future feature requires consent, we will ask for it separately. Acknowledging
            this Privacy Notice is not consent.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="privacy-required">
          <h2 id="privacy-required" className={headingClassName}>4. What is required</h2>
          <p className="text-slate-700">
            An email address, Profile and completed onboarding are required to access the
            app. Without them, we cannot provide the service. Recording training details,
            joining a Team and adding notes are optional, but the related features cannot
            work without the information they require.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="privacy-sharing">
          <h2 id="privacy-sharing" className={headingClassName}>5. Who can receive data</h2>
          <ul className={listClassName}>
            <li>
              <strong>Your Team:</strong> authorised Team participants can see the shared
              training and Team information needed for their role. Athlete-private notes
              remain private to that athlete.
            </li>
            <li>
              <strong>Service providers:</strong> Supabase provides authentication and
              database services; Vercel hosts and delivers the web app; our configured email
              provider delivers service messages; and Google processes sign-in data only if
              you choose Google sign-in.
            </li>
            <li>
              <strong>Authorities or professional advisers:</strong> only when reasonably
              necessary to comply with law, protect rights or handle a legal claim.
            </li>
          </ul>
          <p className="text-slate-700">
            We do not sell personal data and do not share it with advertisers.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="privacy-transfers">
          <h2 id="privacy-transfers" className={headingClassName}>6. International processing</h2>
          <p className="text-slate-700">
            Our providers may process data in Switzerland, the EU or EEA, and the United
            States. Where a transfer requires additional protection, we rely on a recognised
            adequacy decision or appropriate contractual safeguards made available by the
            relevant provider.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="privacy-storage">
          <h2 id="privacy-storage" className={headingClassName}>7. Storage and deletion</h2>
          <p className="text-slate-700">
            We keep personal data while your account is active and for as long as it is
            needed to provide and evaluate the closed beta. We then delete or anonymise it
            unless we need it for a legal obligation, security, dispute resolution or a
            documented audit trail. Minimal deletion markers may remain so that a record you
            deleted is not restored during a later sync.
          </p>
          <p className="text-slate-700">
            Some drafts, offline data and trusted-device information are also stored in your
            browser. They remain there until the app removes them as part of the relevant
            workflow or you clear the site&apos;s browser storage.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="privacy-rights">
          <h2 id="privacy-rights" className={headingClassName}>8. Your rights</h2>
          <p className="text-slate-700">
            Depending on the law that applies, you may ask us for access to your personal
            data, a copy, correction, deletion, restriction or portability, or object to
            certain processing. You may also withdraw any consent you separately gave,
            without affecting earlier lawful processing.
          </p>
          <p className="text-slate-700">
            Send a request to{" "}
            <a
              className="font-medium text-slate-900 underline underline-offset-4"
              href="mailto:info@evolane.swiss"
            >
              info@evolane.swiss
            </a>
            . We may need to confirm your identity. You may also contact the{" "}
            <a
              className="font-medium text-slate-900 underline underline-offset-4"
              href="https://www.edoeb.admin.ch/en"
              rel="noreferrer noopener"
              target="_blank"
            >
              Swiss Federal Data Protection and Information Commissioner
            </a>
            , or your competent local supervisory authority where applicable.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="privacy-automation">
          <h2 id="privacy-automation" className={headingClassName}>9. Automated decisions</h2>
          <p className="text-slate-700">
            The app may calculate statistics and training feedback from the information you
            record. It does not make solely automated decisions that produce legal or
            similarly significant effects about you.
          </p>
        </section>

        <section className={sectionClassName} aria-labelledby="privacy-security">
          <h2 id="privacy-security" className={headingClassName}>10. Security and changes</h2>
          <p className="text-slate-700">
            We use access controls, Profile-scoped storage, encrypted network connections
            and other reasonable technical and organisational measures. No online service
            can guarantee absolute security.
          </p>
          <p className="text-slate-700">
            We may update this notice as the beta changes. The version and effective date at
            the top identify the notice that applies. Material new processing will be
            described before it begins where required.
          </p>
        </section>
      </div>
    </article>
  );
}
