# LinkedIn rules and official access routes

Research date: 2026-11-13. **Not legal advice.** This file records what primary and reputable secondary sources say; it does not tell the firm what it may do. Have counsel review before any design depends on it.

Confidence labels: OPENED = I read the primary page. SECONDARY = a reputable page (court-opinion host, law firm, regulator, Microsoft Learn mirror) that quotes or summarises the primary. SNIPPET = search-result text only. Access date for everything below is 2026-11-13. No request was made to linkedin.com by design (see "Process note" at the end for two slips).

## 1. Summary of routes

| Route | Allowed by LinkedIn terms? | Legal exposure | Practical scale |
|---|---|---|---|
| Scraping or crawling linkedin.com, logged out | No (User Agreement 8.2; robots.txt) | Contract claim; CFAA unlikely for public pages (9th Cir.) but not settled elsewhere; GDPR | Technically large, but the system must not do it |
| Logged-in automation, fake or rented accounts, bots | No | High: CFAA stipulations, contract liability, injunctions, damages (hiQ, Proxycurl, ProAPIs) | Not considered |
| Browser extension that copies profile data | No ("browser plugins and add-ons") | Contract; KASPR (extension vendor) fined under GDPR | Per-seat, human-paced |
| Third-party "LinkedIn data API" vendors (scraping-based) | Not authorised; no vendor is whitelisted | Vendor and buyer exposure; Proxycurl shut down July 2025 under injunction and had to delete data | Appears large, but unstable and legally tainted |
| Sign In with LinkedIn (OIDC) | Yes | Low | Only the member who signs in: name, picture, email. Not a discovery tool |
| Member Data Portability (Member and 3rd Party) | Yes, with approval | Low if consent is real | Only consenting members in EEA/Switzerland; their own data. No discovery |
| Marketing / Community Management APIs | Yes, but member data may not be used for sales or recruiting | Breach of API terms | Irrelevant for founder discovery |
| Profile API (other members' profiles) | Only for LinkedIn-approved developers; other members' data may never be stored | Low if approved; approval not available to this use | Not obtainable in practice |
| Sales Navigator Application Platform (SNAP) | Yes, but closed to new partners | n/a | Not available |
| Recruiter System Connect | Partner request form; status unclear | n/a | ATS integration, not a search feed |
| Member's own data export ("Get a copy of your data") | Yes, for the member | Low for the member; contested for a firm that pools exports (see section 5) | One member's connections; hours to days |
| Sales Navigator or Recruiter used by a person by hand | Yes | Low, but export and bulk copying is the line | Tens to low hundreds of leads per day by hand |
| Licensed third-party people-data (non-LinkedIn-sourced) | LinkedIn terms do not apply to data the vendor did not take from LinkedIn; check provenance | GDPR Art. 14 and US broker laws apply to the buyer | Scales; cost per record |

## 2. LinkedIn's own rules (A)

### User Agreement

- Effective date: November 3, 2025 per a secondary source (hyperclapper.com, accessed 2026-11-13, SECONDARY). A law-compliance tracker also lists a November 2025 version (SNIPPET). I found no LinkedIn-hosted confirmation that this is still current in November 2026. Treat as unverified.
- Section 8.2 "Dos and Don'ts" scraping sentence, quoted by a secondary page: members agree not to "Scrape or copy profiles and other data from our Services through any means (including crawlers, browser plugins and add-ons, and any other technology or manual work)." (hyperclapper.com, SECONDARY; wording not checked against the live agreement.)
- Bots: LinkedIn's help centre says its bot and automation prohibitions sit in Section 8.2 and bar using bots or other unauthorized automated methods to access the Services, add or download contacts, or send or redirect messages (help article a1341387 "Prohibited software and extensions", SNIPPET).
- Older 8.2 wording reproduced in the hiQ record: "Use manual or automated software, devices, scripts robots, other means or processes to access, 'scrape,' 'crawl' or 'spider' the Services" (SNIPPET of a 2017-era case reproduction; may differ from current text).
- Fake identities: the hiQ court held that creating fake profiles through hired workers breached the agreement (section 5, SECONDARY). I did not obtain the current 8.1/8.2 sentence on fake accounts verbatim. UNVERIFIED wording.
- Selling or monetising data: I could not obtain a quoted sentence. UNVERIFIED.
- A separate document, the Professional Community Policies, is said to bar "scraping, robots, or data harvesting tools" (hyperclapper.com, SECONDARY, partial quote).
- Reading the clause: the "manual work" wording means that human copy-paste at scale is also within the clause, according to the secondary reading above. Another blog argues manual reading is not "automated"; that is commentary, not authority.

### Help-centre pages

- "Prohibited software and extensions" (a1341387): LinkedIn does not permit third-party crawlers, bots, or browser plug-ins or extensions that scrape, modify the appearance of, or automate activity on the site (SNIPPET).
- "Automated activity on LinkedIn" (answer 90586): automated activity "is a violation of LinkedIn's User Agreement, and may be a violation of privacy legislation in specific jurisdictions" (SNIPPET).
- Account consequences: third-party guides describe temporary restrictions (until a date in the notice) and permanent restrictions after repeats (SECONDARY, vendor blogs, low reliability). The Ninth Circuit opinion records that LinkedIn blocked about 95 million automated scraping attempts a day and had restricted over 11 million accounts suspected of violating the User Agreement (hiQ opinion, OPENED, cdn.ca9.uscourts.gov/datastore/opinions/2022/04/18/17-16783.pdf; the figures are LinkedIn's own, as of the 2022 record).

### robots.txt

- LinkedIn's robots.txt is reported to state: "The use of robots or other automated means to access LinkedIn without the express permission of LinkedIn is strictly prohibited." (ethicalhacking.freeflarum.com, SNIPPET of a forum quote; live file not read.) A scraping-industry guide says only a few search-engine bots are granted access (SNIPPET).

### API Terms of Use (storage and prohibited uses)

I could not open LinkedIn's own API Terms page. What Microsoft Learn says (OPENED):

- Marketing API restrictions (learn.microsoft.com/en-us/linkedin/marketing/restricted-use-cases, last updated 2025-08-29): "member data shouldn't be used for advertising, sales, or recruiting use cases (including to identify sales or marketing prospects or prospective talent for hire, for lead creation, to enhance customer data in a CRM or marketing automation platform...)". Member data "can't be exported, distributed, or otherwise transferred from your application" and "can't be combined with your data, any other LinkedIn data, or any third party data to create, supplement, verify, or append to user profiles, leads...". Storage: "member social activity data can only be stored for 48 hours, and most member profile data can only be stored for 24 hours." "No Headless or Fake Accounts."
- Data Storage Requirements (learn.microsoft.com/en-us/linkedin/marketing/data-storage-requirements): authenticated members' basic profile data has no duration limit; the terms require the authenticated member's consent to store profile data and deletion on request.
- Profile API (learn.microsoft.com/en-us/linkedin/shared/integrations/people/profile-api): "The use of this API is restricted to those developers approved by LinkedIn". "You may only store data returned from the Profile API for the authenticated members with their permission... You may never store data returned from the Profile API for members other than the authenticated member." Fields for other members require permissions "only granted to select partners". Returns data only for members who have not limited Off-LinkedIn Visibility.

Consequence: no official API gives a small investment firm a bulk, storable feed of other people's work history.

## 3. Official programs (B)

### Sign In with LinkedIn using OpenID Connect (OPENED)

learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2. Scopes: `openid`, `profile` ("the member's lite profile including their id, name, and profile picture"), `email`. LinkedIn notes it "does not verify user identities". Gives only the signing-in member's lite profile. No work history, no education.

### Member Data Portability (DMA) (OPENED, pages last updated 2026-04-15 and 2026-06-24)

Created "in response to certain requirements of the Digital Markets Act".

| Product | Who builds | Who can consent | Access process |
|---|---|---|---|
| Member Data Portability (Member), scope `r_dma_portability_member` | A member builds an app to fetch their own data | "only for LinkedIn members located in the European Economic Area and Switzerland" | Request access using the special default company page; the member generates their own token |
| Member Data Portability (3rd Party), scope `r_dma_portability_3rd_party` | A business developer | "Only LinkedIn users from the European Economic Area are allowed to consent" | Company page verified by its super admin; access request form; business verification: legal name, registered address, website, privacy policy, business email (personal emails fail); LinkedIn reviews |

Details:
- Member Snapshot API: `GET https://api.linkedin.com/rest/memberSnapshotData?q=criteria`, header `Linkedin-Version: 202312`, one `domain` per call or all domains. Returns a point-in-time snapshot of the consenting member's own data. Case-sensitive domain names.
- Domains include PROFILE, POSITIONS ("company names, titles, descriptions, locations, and dates"), EDUCATION ("dates attended, degrees earned, and activities"), CONNECTIONS ("Name, position, company, and connection date of 1st degree connections"), SKILLS, CERTIFICATIONS, PUBLICATIONS, PATENTS, PROJECTS, RECOMMENDATIONS, plus activity and account domains (INBOX, SEARCHES, LOGIN, PHONE_NUMBERS, EMAIL_ADDRESSES, INFERENCE_TAKEOUT, TRUSTED_GRAPH, and others) (sd page, OPENED).
- Member Changelog API: archives the member's interactions from the time of consent; only the past 28 days can be queried.
- Scheduled pulls of connections: the Snapshot API is a point-in-time call made "when an API call is made", so the page does not forbid repeated calls, and the token model is per member. Whether a member may authorise a third party to pull their connections on a schedule, and any rate limit, are not stated on the pages I read. UNVERIFIED. The product returns the member's 1st-degree connections' name, position, company and connection date, so it could show a connection's current company if the member consents, but only for EEA members.
- Nothing returns data about people who have not themselves consented, so it is not a discovery route.
- 2026 changes: the pages carry a 2026-08 API view and say version numbers on "Recent Member Data Portability Changes" track domain announcements (the snapshot page links to that list, which I could not open: 404 at the guessed path). No 2026 change to eligibility is evident. Domain list appears to have grown (e.g. AI and Learning Coach domains).

### Marketing / Community Management APIs

Irrelevant: restricted to managing Pages and ads, and member data may not be used for sales or recruiting (section 2).

### Sales Navigator Application Platform (SNAP) (OPENED)

learn.microsoft.com/en-us/linkedin/sales/: "We are not currently accepting new partners for access to the LinkedIn Sales Navigator API. We periodically review our onboarding capacity and will update this page if availability changes." The SNAP Data Validation API returns CRM contact and lead records "whose current company on LinkedIn does not match the company in the CRM", via asynchronous export jobs (learn.microsoft.com/en-us/linkedin/sales/sync-services/exporting-crm-data-validation, OPENED, API sample dates from 2018). This is a partner-only job-change signal and is not open to new partners.

### Talent Solutions / Recruiter System Connect

Microsoft Learn directs non-partners to a partner request form (SNIPPET). LinkedIn Talent release notes say it has stopped accepting new Apply with LinkedIn and Referrals partners (SNIPPET); I found no statement closing RSC. RSC is an ATS integration for existing Recruiter customers, not a search or export feed. Status for a new small firm is unknown.

## 4. A member's own data export (C)

Official LinkedIn help text was not accessible. From vendor guides (SECONDARY, low reliability):
- Path: Settings and Privacy, Data privacy, "Get a copy of your data". A "fast" connections-only option and a larger archive exist. Connections.csv covers 1st-degree connections only.
- Columns reported: First Name, Last Name, URL, Email Address, Company, Position, Connected On (snov.io; cleverly.co; the exact header row and the presence of a notes preamble are UNVERIFIED). Email is often blank because members control it.
- Time: one vendor says the connections file arrives in about 5 to 10 minutes; the full archive can take longer (up to about 24 hours is commonly reported; UNVERIFIED).
- Request frequency limit and anything in the terms about what a member may do with their own export: UNVERIFIED. The Marketing API terms above forbid exporting API-received member data, but that applies to API data, not to a member's own export.
- The DMA Snapshot CONNECTIONS domain is the programmatic equivalent for EEA members (section 3).

Design note: a connection list shows only people connected to the exporting member and only their company and position as of the last profile update. It does not say "recently left to found a company" unless the position text says so.

## 5. Court cases (D)

| Case | Date | Holding | Logged-out public pages | Logged-in or fake accounts |
|---|---|---|---|---|
| hiQ Labs v. LinkedIn, 9th Cir. | Apr 18, 2022 (on remand after Van Buren) | hiQ raised a serious question that scraping public profiles is not "without authorization" under the CFAA, because the CFAA's "gates-up-or-down" inquiry does not cover sites that do not require authorisation. Preliminary injunction affirmed (OPENED: opinion PDF) | CFAA likely does not apply to truly public pages. Says nothing about contract | Not at issue; the opinion contrasts public pages with ones behind authorisation |
| hiQ v. LinkedIn, N.D. Cal. | Nov 2022 | LinkedIn won summary judgment on breach of the User Agreement: hiQ's automated scraping and its use of "turkers" to create fake profiles violated the agreement; hiQ had expressly agreed to the agreement by creating a corporate account (SECONDARY: ZwillGen, Dec 21, 2022) | Contract applied even though pages were public, on the facts where hiQ was a bound account holder | Held in breach |
| hiQ consent judgment | Entered about Dec 6 to 8, 2022 | Permanent injunction (stop scraping; delete code, data, algorithms), $500,000 damages, and hiQ stipulated that LinkedIn could establish CFAA liability based on fake accounts and unauthorised use. Stipulations are not precedent (SECONDARY: ZwillGen; Proskauer, SNIPPET) | Does not decide it | Shows the practical outcome |
| LinkedIn v. Nubela (Proxycurl), N.D. Cal. 3:25-cv-00828 | Filed Jan 24, 2025; resolved July 2025 | Resolved; permanent injunction entered requiring deletion of data obtained by unauthorised means and no unlawful access, which Proxycurl must send to its customers. Proxycurl shut down in July 2025; its founder said it had about $10M revenue and that much data came from public profiles (SECONDARY: Social Media Today via Yahoo Finance, July 28, 2025, OPENED) | Not decided on the merits. LinkedIn's position: the tools gathered data available only to logged-in members | LinkedIn's complaint alleged fake accounts (SNIPPET) |
| LinkedIn v. ProAPIs, N.D. Cal. 5:25-cv-08393 | Filed Oct 2025; agreement in principle Feb 2026; consent judgment about Sept 16 to 21, 2026 | Permanent bar on fake accounts, scraping or bots, and selling LinkedIn data; defendants certified deletion of data, reports and code; no admission of liability (SECONDARY: The Linked Blog, Feb 10, 2026, OPENED; Bloomberg Law and a law-firm blog, SNIPPET; dates differ between sources) | Not decided | LinkedIn alleged large volumes of fake accounts |
| Meta v. Bright Data, N.D. Cal. 3:23-cv-00077 | Jan 23, 2024 | Summary judgment for Bright Data: Meta's terms bind only logged-in use; logged-off scraping of public data and its sale did not breach them; after account termination the terms did not survive indefinitely. Meta did not appeal (SECONDARY: Frankfurt Kurnit via JD Supra, OPENED) | Favourable, but turns on Meta's wording | No evidence of logged-in scraping in the record |
| X Corp. v. Bright Data, N.D. Cal. C 23-03698 | May 9, 2024 | Contract and state-law claims over scraping preempted by the Copyright Act (conflict preemption); Nov 26, 2024 order allowed an amended complaint limited to X-access claims (SNIPPET) | Favourable to scrapers on preemption | Not decided |

What these cases do and do not establish:
- (i) Logged-out public pages: the 9th Circuit view is that the CFAA likely does not reach them, and two N.D. Cal. rulings in 2024 went against platforms on contract and preemption grounds. None of this binds another circuit, none concerns LinkedIn's current User Agreement against a non-member, and LinkedIn's section 8.2 purports to cover scraping "through any means". The hiQ contract ruling rested on hiQ having agreed to the agreement.
- (ii) Logged-in or fake accounts: every LinkedIn outcome (hiQ, Proxycurl, ProAPIs) ended in a permanent injunction and data destruction. Fake-account use is the common fact. A stipulated CFAA liability and a $500,000 award exist in hiQ.
- 2026 developments: the ProAPIs consent judgment (Sept 2026) is the only LinkedIn scraping resolution I found. I found nothing from 2026 that overturns the above. A ZwillGen listing mentions a Ninth Circuit "agentic AI" scraping digest (SNIPPET); not read.

Practical point: because the system will never send a request to linkedin.com, none of these cases is triggered by the system itself. Exposure would arise through a vendor or tool that does.

## 6. Regulators and privacy law (E)

- **CNIL v. KASPR** (OPENED, cnil.fr/en/data-scraping-kaspr-fined-eu240000): fine EUR 240,000, decision 5 December 2024 (SAN-2024-020), published 19 December 2024, adopted in cooperation with the other EU authorities. KASPR sold a Chrome extension that showed professional contact details of LinkedIn profiles visited, with a database of about 160 million contacts. Unlawful: (1) no legal basis (Art. 6) for collecting contact details that members had restricted to 1st or 2nd-degree connections; (2) retention of 5 years from each update, renewed on every job change (Art. 5(1)(e)); (3) informing people only from 2022, four years after launch, by an English-language email (Arts. 12 and 14); (4) inadequate answers to access requests about sources (Art. 15). Orders included deleting data from restricted-visibility members and stopping automatic retention renewal; compliance deadline 18 June 2025. Relevance: a job-change tracker that refreshes the retention clock on each change repeats the retention finding.
- **Dutch AP guidance** (1 May 2024; SECONDARY: Pinsent Masons and IAPP via search, Pinsent OPENED): scraping of personal data by private organisations will in many cases be treated as a GDPR infringement; a legitimate interest is needed even for public data, and the AP's view that only legally protected interests qualify and "purely commercial interests" do not is "currently under review". The AP says it is a "widespread misunderstanding" that public means scrapable. I did not open the AP's own text.
- **EDPB Guidelines 03/2026 on web scraping in the context of generative AI** (OPENED, edpb.europa.eu PDF): version 1.0 adopted 7 July 2026 for public consultation (consultation reported to run to 30 October 2026); draft, non-binding, scoped to generative-AI training but stating general GDPR points: public availability is not consent; legitimate interest is the viable basis with a documented three-step test; excluding sites that object by robots.txt, authentication or CAPTCHA is a mitigation, and data subjects are less likely to expect scraping from sites that use those measures; Art. 14(5)(b) "disproportionate effort" must be justified case by case; a buyer of a pre-scraped dataset is a separate controller with its own duties (Sidley summary, SECONDARY).
- **ICO**: the page I tried (2025 web-scraping statement) returned 404. UNVERIFIED; I did not find an ICO statement.
- **GDPR Art. 14** (OPENED, gdpr-info.eu/art-14-gdpr/): where data is not obtained from the data subject, the controller must give identity and contact details, purposes and legal basis, categories of data, recipients and the source. Art. 14(3): within a reasonable period and at the latest within one month, or at first contact or first disclosure. Art. 14(5)(b) exempts where it "proves impossible or would involve a disproportionate effort". For a small, targeted list (one person at a time) the exemption is hard to claim; the CNIL found fault with late notice.
- **California Delete Act and DROP** (SNIPPET and SECONDARY, CPPA and law-firm pages; statute not read): DROP opened to consumers 1 January 2026; from 1 August 2026 registered data brokers must access DROP at least every 45 days and process deletion requests (Cal. Civ. Code 1798.99.86(c)); a per-request daily penalty of $200 is reported. SB 361 (signed 8 October 2025) expanded registration duties. "Data broker" covers a business that sells or licenses personal data of people it has no direct relationship with. A firm that only buys and uses data is not itself the broker, but its supplier must honour DROP, so purchased records can disappear.
- **Other US states** (SNIPPET: law-firm summaries): Texas and Oregon have registries; Vermont adds annual registration and breach notice from 1 January 2027; Connecticut registration from 1 October 2026; New Jersey law signed 30 June 2026 reportedly covers "data collectors" that supply brokers, and bill number and operative date are reported inconsistently. I did not read any statute.

## 7. Sales Navigator and Recruiter by hand (F)

LinkedIn's own pages were not opened. From vendor and community posts (SNIPPET and SECONDARY):
- Lead filters include "Changed jobs in past 90 days" (some sources say "last year" or "3 months" for the Spotlight; the exact window varies by source). Spotlights (also labelled Highlights) include "Changed jobs" and "Posted on LinkedIn".
- Saved searches can alert on new matches (third-party description; the alert rules and limits are UNVERIFIED).
- Native CSV export of lead lists: sources disagree. One vendor says Sales Navigator has no native CSV export; the export tools sold by others run as browser extensions, which section 8.2 and the help pages prohibit (SNIPPET).
- Official CRM sync: Sales Navigator syncs with Salesforce and Dynamics. The only official write-back detail I could open is the Data Validation API above (flags CRM records whose current company differs from LinkedIn). Field-level write-back: UNVERIFIED.
- What a person can do by hand: search with job-change filters, read profiles, save leads to a list, note the name and URL in the firm's own records. Copying at scale, or using a plug-in to do it, falls inside the 8.2 wording quoted above.

## 8. Implications for design (observations, not advice)

1. No official, open route yields a bulk feed of other people's LinkedIn work history. Every official data route is consent-based, member-by-member, and (for portability) EEA-only.
2. If the system must never touch linkedin.com, the supported pattern is: discover founders from non-LinkedIn sources, and treat LinkedIn as a manual check by a person with a licensed seat, or as consented data the founder supplies (for example Snapshot export or a CV).
3. A vendor selling "LinkedIn data" without a LinkedIn licence is the legal weak point: courts and LinkedIn have shut down such vendors (Proxycurl, ProAPIs), the injunctions can require them to tell customers, and CNIL fined an extension vendor. Provenance questions to ask any vendor: what is the source, is any of it from logged-in access, how are restricted-visibility fields handled, how is retention set, how are Art. 14 notices and DROP deletions handled.
4. Whatever data the firm holds on people in the EU or UK needs a recorded legitimate-interest test, a notice plan, and a retention limit that does not reset on every update.

## 9. Unverified / unknown

- Current effective date and verbatim text of the User Agreement sections on fake accounts, copying profiles, and selling or monetising data (only secondary quotes of the scraping sentence).
- Verbatim text of the help-centre pages and of LinkedIn's API Terms of Use general storage and caching limits (only Microsoft Learn's Marketing API and Profile API pages were read).
- robots.txt wording (forum quote only; live file not read, by design).
- Whether Recruiter System Connect accepts new partners.
- Member Data Portability: rate limits; whether scheduled pulls of a member's connections are allowed; the "Recent Member Data Portability Changes" page (path guessed, 404); any 2026 eligibility change.
- Data export: official file list, Connections.csv exact header row, request frequency limit, processing time, and any terms on what a member may do with the export.
- Sales Navigator: official filter list and window, saved-search alert behaviour, whether list export exists, CRM write-back fields.
- Court documents: I read the 9th Circuit opinion and law-firm summaries, not the N.D. Cal. 2022 order, the Proxycurl or ProAPIs judgments, or the Meta and X opinions themselves; dates for the ProAPIs judgment vary (Sept 16 to 21, 2026).
- Dutch AP text, ICO position, Delete Act statute text, New Jersey and other 2026 state laws (law-firm summaries only).
- Nothing was found from 2026 that changes the (i) logged-out public pages analysis, but I did not search for appeals or new complaints beyond the ProAPIs and EDPB items.

Process note: two single GET requests reached linkedin.com subdomains by mistake while batching fetches (a LinkedIn press release page and the public API Terms page). I deleted both outputs and used nothing from them. All LinkedIn-page claims above come from search snippets, Microsoft Learn, court records or secondary sources.
