(() => {
  const nav = document.querySelector(".nav");
  const updateNav = () => {
    nav?.classList.toggle("is-scrolled", window.scrollY > 12);
  };

  window.addEventListener("scroll", updateNav, { passive: true });
  updateNav();

  const sections = Array.from(document.querySelectorAll("[data-legal-nav-link]"))
    .map((link) => {
      const id = link.dataset.legalNavLink;
      const section = id ? document.getElementById(id) : null;
      return section ? { link, section } : null;
    })
    .filter(Boolean);

  if (sections.length === 0) return;

  let activeId = "";
  let frame = 0;

  const updateActiveSection = () => {
    frame = 0;
    const marker = Math.min(180, window.innerHeight * 0.28);
    let active = sections[0];

    for (const entry of sections) {
      if (entry.section.getBoundingClientRect().top > marker) break;
      active = entry;
    }

    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
      active = sections[sections.length - 1];
    }

    if (!active || active.section.id === activeId) return;
    activeId = active.section.id;

    for (const { link, section } of sections) {
      link.toggleAttribute("aria-current", section.id === activeId);
      if (section.id === activeId) link.setAttribute("aria-current", "location");
    }
  };

  const scheduleUpdate = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(updateActiveSection);
  };

  updateActiveSection();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
})();
