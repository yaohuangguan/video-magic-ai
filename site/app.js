const repo = "yaohuangguan/video-magic-ai";
const releaseApi = "https://api.github.com/repos/" + repo + "/releases/latest";

async function hydrateLatestRelease() {
  try {
    const response = await fetch(releaseApi, {
      headers: { Accept: "application/vnd.github+json" }
    });
    if (!response.ok) return;

    const release = await response.json();
    const installer = Array.isArray(release.assets)
      ? release.assets.find((asset) => asset.name === "VideoMagic-Windows-x64-setup.exe")
      : null;

    document.querySelectorAll(".release-label").forEach((node) => {
      node.textContent = release.tag_name || "Latest release";
    });

    document.querySelectorAll(".release-page").forEach((node) => {
      node.href = release.html_url;
    });

    if (installer?.browser_download_url) {
      document.querySelectorAll(".download-link").forEach((node) => {
        node.href = installer.browser_download_url;
      });
    }
  } catch {
    // Keep the stable /releases/latest fallback links.
  }
}

hydrateLatestRelease();
