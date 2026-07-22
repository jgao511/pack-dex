export const PACKDEX_SUPPORT_EMAIL = "packdexsupport@gmail.com";
export const LEGAL_LAST_UPDATED = "July 21, 2026";

export const LEGAL_ROUTES = {
  privacy: "/privacy",
  terms: "/terms",
};

export const LEGAL_DOCUMENTS = {
  privacy: {
    label: "Privacy",
    title: "Privacy Policy",
    pageTitle: "Privacy Policy | PackDex",
    metaDescription:
      "Learn how PackDex handles account, collection, app, sharing, technical, and privacy-choice information.",
    introduction: [
      "This Privacy Policy explains how PackDex handles information when you use the PackDex website, web application, or native mobile application.",
      "PackDex is a fan-made, unofficial Pokémon TCG pack-opening simulator and collection-tracking service. It is not affiliated with or endorsed by Nintendo, Creatures, GAME FREAK, or The Pokémon Company.",
    ],
    sections: [
      {
        title: "Information you provide",
        paragraphs: [
          "If you create an account, Supabase processes your email address, password, authentication tokens, and account identifier to provide authentication. PackDex does not store your password in its application database in readable form.",
          "Depending on the features you use, PackDex may process virtual collection and binder records, wishlist entries, simulated pack-opening history, profile statistics, achievement progress, welcome-reward state, application preferences, support communications, and account-deletion requests. PackDex does not ask for payment details, a postal address, or a phone number.",
        ],
      },
      {
        title: "Information generated through use of PackDex",
        paragraphs: [
          "Using PackDex can generate records about simulated packs, virtual cards added to a collection, binder organization, wishlist activity, achievement progress, aggregate statistics, preferences, public pull shares, and security or abuse-prevention events.",
          "Simulated cards, pulls, achievements, statistics, and collection records are virtual records only. They do not represent a purchase or ownership of physical cards.",
        ],
      },
      {
        title: "Technical information",
        paragraphs: [
          "PackDex and the providers used to operate it may process technical information such as IP address, browser or device type, operating system, app version, referring page, approximate region inferred from an IP address, request timestamps, basic interactions, security or fraud signals, and error, performance, or diagnostic information.",
          "PackDex does not currently use a dedicated analytics, behavioral-profiling, or crash-reporting SDK. Hosting, database, security, and other infrastructure providers may still create operational logs needed to deliver and protect their services.",
        ],
      },
      {
        title: "Cookies, local storage, and similar technologies",
        paragraphs: [
          "PackDex uses browser or device storage for authentication and session continuity, security, guest collections and binders, pending synchronization, preferences, interface settings, recent in-app activity, and other core application state. Authentication libraries and service providers may also use storage needed to maintain a secure session.",
          "This essential storage supports core functionality. Optional measurement or advertising storage may be introduced in the future, but advertising-related storage is not currently active. Disabling or clearing essential storage may sign you out or remove locally saved guest data and preferences.",
        ],
      },
      {
        title: "How PackDex uses information",
        items: [
          "Provide authentication and account recovery.",
          "Save and synchronize virtual collections, binders, wishlists, statistics, achievements, and preferences.",
          "Generate, display, and protect public pull-sharing links.",
          "Provide card information and estimated pricing features.",
          "Respond to support, privacy, and account-deletion requests.",
          "Maintain reliability, investigate errors, enforce limits, and protect PackDex from abuse.",
          "Comply with applicable legal obligations and enforce PackDex policies.",
        ],
      },
      {
        title: "Advertising",
        paragraphs: [
          "PackDex does not currently display advertising. PackDex may display advertising provided by third-party advertising partners in the future, and those providers may include Google once advertising is enabled.",
          "Where permitted, advertising partners may process information such as IP address, browser or device information, approximate location, advertising identifiers, consent preferences, and interactions with advertisements. Advertising may be contextual or personalized depending on user choices, regional requirements, platform permissions, and applicable law.",
          "Optional advertising technologies will be enabled only as permitted and subject to applicable consent or privacy controls. Available advertising and consent choices will be presented through PackDex's Privacy Choices control where required. Google AdSense, Google AdMob, personalized advertising, and Google consent tools are not currently active in PackDex.",
        ],
      },
      {
        title: "Privacy Choices",
        paragraphs: [
          "PackDex provides a Privacy Choices control for available privacy and advertising choices. While advertising is inactive, that control is informational. Additional options may appear if advertising is enabled.",
          "Available controls may vary by region, platform, applicable law, whether advertising is active, and whether you use the website or a native app.",
        ],
      },
      {
        title: "Third-party services",
        paragraphs: [
          "PackDex relies on third parties that may process information under their own terms and privacy practices. Confirmed services include Supabase for authentication, databases, and server functions; Cloudflare for deployed web routing, delivery, security, and Turnstile abuse prevention; Google-hosted fonts and Gmail-based support communications; the Pokémon TCG API for server-side card and pricing data; and TCGplayer for pricing references and outbound marketplace links.",
          "PackDex also links to external social, video, and marketplace services. PackDex does not control those services, their availability, their content, their privacy practices, or transactions made through them. A link or advertisement does not imply PackDex's endorsement.",
        ],
      },
      {
        title: "Public pull sharing",
        paragraphs: [
          "When you create a public pull share, PackDex stores a randomly generated share code, the set identifier, card identifiers, an optional pack number, and creation and expiration timestamps. The public share record does not include your email address or account identifier. Separate IP-address and, when signed in, account-based rate-limit records may be processed to prevent abuse.",
          "Anyone with a valid link can view the shared simulated pull. Share links are configured to expire after one year and may be removed, disabled, or become unavailable earlier. Because public shares are not linked to an account in the public-share record, deleting an account does not necessarily remove an existing share before its separate expiration.",
        ],
      },
      {
        title: "Card prices and third-party links",
        paragraphs: [
          "Card prices are informational estimates based on third-party data. They may be incomplete, delayed, inaccurate, or unavailable, and PackDex does not guarantee a card's market value.",
          "Marketplace links lead to services PackDex does not control. You are responsible for evaluating external listings, sellers, transactions, and risks before acting on third-party information.",
        ],
      },
      {
        title: "Data retention",
        paragraphs: [
          "Account information may be retained while your account remains active and as needed to provide PackDex, maintain security, resolve disputes, comply with law, or enforce policies. Retention varies by data category and provider. Deleted information may remain temporarily in backups, security records, or operational logs before it is removed through normal provider processes.",
          "Public shares and rate-limit records follow separate retention behavior. Public shares are configured with an expiration, while providers may retain their own operational records under their policies.",
        ],
      },
      {
        title: "Account deletion and your controls",
        paragraphs: [
          "Signed-in users can initiate account deletion from Settings or the account area. The deletion process removes the Supabase authentication user and account-owned PackDex application records, then clears identified PackDex account state from the device used for the request. Some information may remain temporarily in backups or operational logs, and public shares have separate expiration behavior.",
          "You can update available application preferences in PackDex. You may contact support to ask about access, correction, deletion, or other privacy concerns. Your privacy rights and available controls may vary depending on where you live.",
        ],
      },
      {
        title: "Children",
        paragraphs: [
          "PackDex is intended for a general audience. Users should create an account only when they are legally permitted to do so, and a parent or guardian should review the service when required by applicable law. If you believe personal information from a child should be reviewed or deleted, contact PackDex support.",
        ],
      },
      {
        title: "Security",
        paragraphs: [
          "PackDex uses reasonable technical and organizational safeguards intended to protect account information, including authentication, access controls, and abuse-prevention measures. No online or device-based system can guarantee absolute security. Protect your credentials and contact support if you believe your account has been compromised.",
        ],
      },
      {
        title: "International processing",
        paragraphs: [
          "PackDex's service providers may process information in countries other than the country where you live. Privacy and data-protection rules may differ between those locations.",
        ],
      },
      {
        title: "Changes to this policy",
        paragraphs: [
          "PackDex may update this Privacy Policy as the service, providers, or legal requirements change. The last-updated date shown on this page will be revised when the policy changes.",
        ],
      },
      {
        title: "Contact",
        contact: "For privacy questions or requests, contact PackDex support at",
      },
      {
        title: "Fan-made project and intellectual property",
        paragraphs: [
          "PackDex is fan-made and is not affiliated with or endorsed by Nintendo, Creatures, GAME FREAK, or The Pokémon Company. Pokémon names, artwork, card images, logos, and trademarks belong to their respective owners. PackDex does not claim ownership of those materials.",
        ],
      },
    ],
  },
  terms: {
    label: "Terms",
    title: "Terms of Service",
    pageTitle: "Terms of Service | PackDex",
    metaDescription:
      "Review the terms governing PackDex's simulated pack opening, virtual collection, sharing, pricing, and account features.",
    introduction: [
      "These Terms of Service govern your use of the PackDex website, web application, and native mobile application. By using PackDex, you agree to these Terms. If you do not agree, do not use the service.",
    ],
    sections: [
      {
        title: "Eligibility",
        paragraphs: [
          "You may use PackDex only if you are legally able to agree to these Terms under the laws that apply to you. If you are a minor, use PackDex only with the permission and supervision required in your location. PackDex does not establish a separate minimum age in these Terms.",
        ],
      },
      {
        title: "Accounts",
        paragraphs: [
          "Provide accurate account information, protect your credentials, and take responsibility for activity through your account. You may request account deletion through the controls provided by PackDex.",
          "PackDex may restrict, suspend, or terminate accounts involved in abuse, security threats, legal violations, or violations of these Terms.",
        ],
      },
      {
        title: "Nature of PackDex",
        paragraphs: [
          "PackDex is a fan-made entertainment project that provides simulated pack opening and digital collection-tracking tools. Pack openings are simulated. Digital collection records do not represent ownership of physical cards, and PackDex does not sell or award physical Pokémon cards.",
          "Simulated pulls, achievements, statistics, rewards, and other virtual records have no cash value and cannot be redeemed. PackDex does not guarantee that simulations match real-world pull rates or the contents of any physical product unless a feature expressly says otherwise.",
        ],
      },
      {
        title: "Collection and account data",
        paragraphs: [
          "You may record simulated pulls and virtual collection information in PackDex. Stored records may contain errors, become unavailable, or change as the service evolves. Do not rely on PackDex as the sole permanent archive of records that are important to you.",
          "Collection, wishlist, binder, achievement, statistics, pricing, and other features may be corrected, changed, reset, or discontinued.",
        ],
      },
      {
        title: "Card prices and external marketplaces",
        paragraphs: [
          "Pricing information is informational only and may be delayed, inaccurate, incomplete, or unavailable. PackDex does not provide financial, investment, appraisal, purchasing, or selling advice.",
          "External marketplace listings, sellers, purchases, sales, disputes, and losses are outside PackDex's control. Evaluate third-party services and transactions independently.",
        ],
      },
      {
        title: "Public sharing",
        paragraphs: [
          "PackDex may let you create a public link for a simulated pull. Anyone with a valid link may be able to view the shared set, cards, and optional pack number. Do not include or distribute private information with a share link.",
          "Share links may expire, be removed, or become unavailable. PackDex may disable sharing or shared material connected with abuse, unlawful activity, security risks, or violations of these Terms.",
        ],
      },
      {
        title: "Acceptable use",
        paragraphs: ["You must not:"],
        items: [
          "Interfere with, disrupt, attack, or overload PackDex or its providers.",
          "Attempt unauthorized access or circumvent authentication, security controls, or rate limits.",
          "Scrape, extract, reverse engineer where prohibited, or automate access in a way that burdens or violates the service.",
          "Upload or transmit malicious code, impersonate another person, use PackDex unlawfully, or abuse public share links.",
          "Exploit bugs or manipulate accounts, simulated records, rewards, statistics, or service activity at scale.",
          "If advertising is enabled, generate fraudulent impressions or clicks, encourage clicks merely to support PackDex, use bots for ad activity, or interfere with ad delivery or measurement.",
        ],
      },
      {
        title: "Advertising",
        paragraphs: [
          "PackDex does not currently display advertising but may show third-party advertisements in the future. Ad formats and availability may change, and advertising may help support PackDex.",
          "An advertisement does not imply PackDex's endorsement. PackDex does not control advertised products, services, claims, or external destinations, and you interact with advertisers at your own discretion. Advertising will not grant physical cards, cash value, or ownership rights. PackDex may consider paid or ad-free options later but does not promise that such options will be offered.",
        ],
      },
      {
        title: "PackDex and third-party intellectual property",
        paragraphs: [
          "PackDex's original code, branding, interface, and original content are protected by applicable intellectual-property laws. These Terms do not give you ownership of PackDex materials or permission to misuse PackDex branding.",
          "Pokémon names, card artwork, card images, logos, trademarks, and related materials belong to their respective owners. PackDex does not claim ownership of Pokémon intellectual property, and nothing in these Terms overstates PackDex's rights to third-party materials.",
        ],
      },
      {
        title: "Third-party services and links",
        paragraphs: [
          "PackDex relies on and links to third-party services for functions such as authentication, hosting, security, card data, pricing, and external destinations. PackDex does not control and is not responsible for their availability, content, policies, actions, listings, or transactions.",
        ],
      },
      {
        title: "Service changes and availability",
        paragraphs: [
          "PackDex may change, suspend, or discontinue features. Providers may become unavailable, outages may occur, and sets, cards, prices, simulations, or other content may contain errors. PackDex does not guarantee uninterrupted, permanent, or error-free operation.",
        ],
      },
      {
        title: "Enforcement and termination",
        paragraphs: [
          "PackDex may investigate suspected misuse and suspend or terminate access when reasonably necessary to address abuse, security concerns, legal requirements, or violations of these Terms. Virtual records do not have monetary ownership status.",
        ],
      },
      {
        title: "Disclaimers",
        paragraphs: [
          "PackDex is provided on an “as available” basis for entertainment and informational purposes. To the extent permitted by applicable law, PackDex makes no promise that the service will always be available, accurate, complete, secure, or suitable for a particular purpose. Rights that cannot legally be waived remain unaffected.",
        ],
      },
      {
        title: "Limitation of liability",
        paragraphs: [
          "To the extent permitted by applicable law, PackDex and its operators will not be responsible for indirect or unexpected losses arising from use of, inability to use, or reliance on the service or third-party links. PackDex does not exclude liability that applicable law does not allow to be excluded.",
        ],
      },
      {
        title: "Changes to these Terms",
        paragraphs: [
          "PackDex may update these Terms as the service changes. The revised Terms will be posted with a new last-updated date. Continued use after updated Terms take effect means you agree to the updated Terms where permitted by law.",
        ],
      },
      {
        title: "Contact",
        contact: "For questions about these Terms, contact PackDex support at",
      },
      {
        title: "Fan-made disclaimer",
        paragraphs: [
          "PackDex is a fan-made project and is not affiliated with or endorsed by Nintendo, Creatures, GAME FREAK, or The Pokémon Company.",
        ],
      },
    ],
  },
};
