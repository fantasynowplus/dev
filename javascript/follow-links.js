// Edit this to add, remove, reorder, or update links/sections on /follow.
//
// Structure: an array of sections. Each section has a "title" (shown as a
// small heading) and "links" (an array of cards).
//
// Each link card supports:
//   name    - bold label
//   handle  - small subtext under the name
//   url     - where the card goes when clicked
//   iconBg  - icon tile color/CSS background
//   iconSvg - inline SVG markup for the icon
//   extra   - OPTIONAL array of secondary chip links shown inside the same
//             card (e.g. a channel's separate TikTok handle). Each chip
//             takes the same name/url/iconBg/iconSvg shape as a link card.
//   videoKey - OPTIONAL, YouTube cards only. Must match a source_id in the
//             Supabase youtube_videos table (the channel's "All Videos"
//             playlist id) so the card can show that channel's latest
//             video. Add/remove this field to turn the feature on/off.

const YT_ICON = '<svg viewBox="0 0 24 24" fill="#FFFFFF"><path d="M23.5 6.2a3 3 0 0 0-2.12-2.13C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.38.57A3 3 0 0 0 .5 6.2 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.8 3 3 0 0 0 2.12 2.13C4.5 20.5 12 20.5 12 20.5s7.5 0 9.38-.57a3 3 0 0 0 2.12-2.13A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.8ZM9.6 15.6V8.4L15.8 12l-6.2 3.6Z"/></svg>';

const TIKTOK_ICON = '<svg viewBox="0 0 24 24" fill="#FFFFFF"><path d="M16.5 2h-3.3v13.9c0 1.53-1.24 2.79-2.78 2.79a2.79 2.79 0 0 1-2.78-2.79 2.79 2.79 0 0 1 2.78-2.79c.3 0 .6.05.87.14v-3.36a6.1 6.1 0 0 0-.87-.06 6.13 6.13 0 0 0-6.11 6.13A6.13 6.13 0 0 0 10.42 22a6.13 6.13 0 0 0 6.13-6.13V8.77a8.2 8.2 0 0 0 4.7 1.48V6.94a4.85 4.85 0 0 1-4.75-4.94Z"/></svg>';

const FOLLOW_SECTIONS = [
  {
    title: "Watch on YouTube",
    links: [
      {
        name: "FantasyNow+",
        handle: "@fantasynowplus \u00b7 main channel",
        url: "https://www.youtube.com/@fantasynowplus",
        iconBg: "#FF0000",
        iconSvg: YT_ICON,
        videoKey: "PLX9LyZ57O4HCZOz665YESxq60eiU0c6Gz"
      },
      {
        name: "FantasyNow+ Dynasty",
        handle: "@fantasynowplusdynasty",
        url: "https://www.youtube.com/@fantasynowplusdynasty",
        iconBg: "#FF0000",
        iconSvg: YT_ICON,
        videoKey: "PLD17XfyD48QU"
      },
      {
        name: "Get Tilted",
        handle: "@fantasynowplusgettilted \u00b7 DFS & betting",
        url: "https://www.youtube.com/@fantasynowplusgettilted",
        iconBg: "#FF0000",
        iconSvg: YT_ICON,
        videoKey: "PLeOI83uRg6RY",
        extra: [
          {
            name: "Also on TikTok",
            handle: "@get.tilted",
            url: "https://www.tiktok.com/@get.tilted",
            iconBg: "#000000",
            iconSvg: TIKTOK_ICON
          }
        ]
      }
    ]
  },
  {
    title: "Follow everywhere else",
    links: [
      {
        name: "Website",
        handle: "fantasynowplus.com",
        url: "https://www.fantasynowplus.com/",
        iconBg: "transparent",
        iconImg: "assets/images/social-logo.png"
      },
      {
        name: "Discord",
        handle: "Join the community",
        url: "https://discord.gg/c4rbyyaQYh",
        iconBg: "#5865F2",
        iconSvg: '<svg viewBox="0 0 24 24" fill="#FFFFFF"><path d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3c-.211.375-.457.879-.626 1.281a18.27 18.27 0 0 0-5.518 0C9.572 3.879 9.32 3.375 9.109 3A19.736 19.736 0 0 0 4.677 4.369C1.913 8.48 1.157 12.485 1.535 16.436a19.9 19.9 0 0 0 6.06 3.06c.49-.666.926-1.373 1.302-2.117a12.9 12.9 0 0 1-2.051-.983c.172-.126.34-.257.502-.392 3.955 1.83 8.237 1.83 12.145 0 .164.135.332.266.502.392-.652.39-1.34.72-2.054.984.377.744.812 1.451 1.303 2.117a19.86 19.86 0 0 0 6.062-3.06c.444-4.583-.757-8.549-3.19-12.068ZM8.02 14.1c-1.183 0-2.157-1.095-2.157-2.438 0-1.343.955-2.439 2.157-2.439 1.21 0 2.176 1.104 2.157 2.439 0 1.343-.947 2.438-2.157 2.438Zm7.962 0c-1.183 0-2.157-1.095-2.157-2.438 0-1.343.956-2.439 2.157-2.439 1.21 0 2.176 1.104 2.157 2.439 0 1.343-.938 2.438-2.157 2.438Z"/></svg>'
      },
      {
        name: "Bluesky",
        handle: "@fantasynowplus.com",
        url: "https://bsky.app/profile/fantasynowplus.com",
        iconBg: "#1185FE",
        iconSvg: '<svg viewBox="0 0 36 36" fill="#FFFFFF"><path d="M17.985 16.236c-1.6-3.1-5.94-8.89-9.98-11.74-3.87-2.73-5.35-2.26-6.31-1.82-1.12.51-1.32 2.23-1.32 3.24 0 1.01.55 8.3.92 9.51 1.2 4.02 5.45 5.38 9.37 4.94.2-.03.4-.06.61-.08-.2.03-.41.06-.61.08-5.74.85-10.85 2.94-4.15 10.39 7.36 7.62 10.09-1.63 11.49-6.33 1.4 4.69 3.01 13.61 11.35 6.33 6.27-6.33 1.72-9.54-4.02-10.39-.2-.02-.41-.05-.61-.08.21.03.41.05.61.08 3.92.44 8.18-.92 9.37-4.94.36-1.22.92-8.5.92-9.51 0-1.01-.2-2.73-1.32-3.24-.97-.44-2.44-.91-6.31 1.82-4.07 2.86-8.41 8.64-10.01 11.74z"/></svg>'
      },
      {
        name: "Facebook",
        handle: "fantasynowplus",
        url: "https://www.facebook.com/fantasynowplus",
        iconBg: "#1877F2",
        iconSvg: '<svg viewBox="0 0 24 24" fill="#FFFFFF"><path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.9 3.77-3.9 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.44 2.91h-2.34V22c4.78-.76 8.44-4.92 8.44-9.94Z"/></svg>'
      },
      {
        name: "X (Twitter)",
        handle: "@fantasynowplus",
        url: "https://www.x.com/fantasynowplus",
        iconBg: "#000000",
        iconSvg: '<svg viewBox="0 0 24 24" fill="#FFFFFF"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z"/></svg>'
      },
      {
        name: "Instagram",
        handle: "@fantasynowplus",
        url: "https://www.instagram.com/fantasynowplus",
        iconBg: "radial-gradient(circle at 30% 110%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285AEB 90%)",
        iconSvg: '<svg viewBox="0 0 24 24" fill="#FFFFFF"><path d="M12 2c2.72 0 3.06.01 4.12.06 1.06.05 1.79.22 2.43.47.66.26 1.21.6 1.76 1.15.55.55.89 1.1 1.15 1.76.25.64.42 1.37.47 2.43.05 1.06.06 1.4.06 4.12s-.01 3.06-.06 4.12c-.05 1.06-.22 1.79-.47 2.43-.26.66-.6 1.21-1.15 1.76-.55.55-1.1.89-1.76 1.15-.64.25-1.37.42-2.43.47-1.06.05-1.4.06-4.12.06s-3.06-.01-4.12-.06c-1.06-.05-1.79-.22-2.43-.47a4.9 4.9 0 0 1-1.76-1.15 4.9 4.9 0 0 1-1.15-1.76c-.25-.64-.42-1.37-.47-2.43C2.01 15.06 2 14.72 2 12s.01-3.06.06-4.12c.05-1.06.22-1.79.47-2.43.26-.66.6-1.21 1.15-1.76A4.9 4.9 0 0 1 5.44 2.54c.64-.25 1.37-.42 2.43-.47C8.94 2.01 9.28 2 12 2Zm0 1.8c-2.67 0-2.99.01-4.04.06-.87.04-1.34.18-1.65.3-.42.16-.71.35-1.02.66-.31.31-.5.6-.66 1.02-.12.31-.26.78-.3 1.65-.05 1.05-.06 1.37-.06 4.04s.01 2.99.06 4.04c.04.87.18 1.34.3 1.65.16.42.35.71.66 1.02.31.31.6.5 1.02.66.31.12.78.26 1.65.3 1.05.05 1.37.06 4.04.06s2.99-.01 4.04-.06c.87-.04 1.34-.18 1.65-.3.42-.16.71-.35 1.02-.66.31-.31.5-.6.66-1.02.12-.31.26-.78.3-1.65.05-1.05.06-1.37.06-4.04s-.01-2.99-.06-4.04c-.04-.87-.18-1.34-.3-1.65a2.75 2.75 0 0 0-.66-1.02 2.75 2.75 0 0 0-1.02-.66c-.31-.12-.78-.26-1.65-.3-1.05-.05-1.37-.06-4.04-.06Zm0 3.65a4.55 4.55 0 1 1 0 9.1 4.55 4.55 0 0 1 0-9.1Zm0 1.8a2.75 2.75 0 1 0 0 5.5 2.75 2.75 0 0 0 0-5.5Zm4.73-1.99a1.06 1.06 0 1 1-2.12 0 1.06 1.06 0 0 1 2.12 0Z"/></svg>'
      },
      {
        name: "TikTok",
        handle: "@fantasynowplus",
        url: "https://www.tiktok.com/@fantasynowplus",
        iconBg: "#000000",
        iconSvg: TIKTOK_ICON
      }
    ]
  },
  {
    title: "Our Partners",
    links: [
      {
        name: "Drafters",
        handle: "Use code FN+",
        url: "https://drafters.com/refer/fn+",
        iconBg: "transparent",
        iconImg: "assets/images/drafters-logo.png"
      },
      {
        name: "Underdog Fantasy",
        handle: "Use code FNPLUS",
        url: "https://play.underdogfantasy.com/p-fnplus",
        iconBg: "transparent",
        iconImg: "assets/images/underdog-logo.png"
      }
    ]
  }
];