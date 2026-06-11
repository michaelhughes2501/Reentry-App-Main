/* New Horizon — Landing Page JavaScript
   Vanilla JS, no dependencies, CSP-safe (no inline handlers).
*/

(function () {
  'use strict';

  /* ── Sticky nav — only touch the DOM when the scrolled state changes ── */
  var nav = document.getElementById('site-nav');
  if (nav) {
    var isScrolled = false;
    window.addEventListener('scroll', function () {
      var scrolled = window.scrollY > 20;
      if (scrolled !== isScrolled) {
        isScrolled = scrolled;
        nav.classList.toggle('scrolled', scrolled);
      }
    }, { passive: true });
  }

  /* ── Mobile nav toggle (with aria-expanded for screen readers) ── */
  var navToggle = document.querySelector('.nav-toggle');
  var navMobile = document.getElementById('nav-mobile');
  if (navToggle && navMobile) {
    navToggle.addEventListener('click', function () {
      var open = navMobile.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
  }

  /* Close mobile nav on link click ── */
  if (navMobile) {
    navMobile.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        navMobile.classList.remove('open');
        if (navToggle) navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ── Smooth scroll for in-page anchor links ──
     getElementById avoids DOMExceptions from IDs that are invalid CSS selectors. */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var id = this.getAttribute('href');
      if (!id || id === '#') return;
      var target = document.getElementById(id.slice(1));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
      }
    });
  });

  /* ── Intersection Observer — scroll-triggered reveals ── */
  var revealTargets = document.querySelectorAll(
    '.resource-card, .step, .testimonial-card'
  );
  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealTargets.forEach(function (el) { observer.observe(el); });
  } else {
    /* Fallback: show everything immediately */
    revealTargets.forEach(function (el) { el.classList.add('in-view'); });
  }

  /* ── CTA form ── */
  var ctaForm = document.getElementById('cta-form');
  if (ctaForm) {
    var zipRegex = /^\d{5}(-\d{4})?$/;
    ctaForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var zip = document.getElementById('zip').value.trim();
      var msgEl = document.getElementById('form-message');

      if (!zip) {
        msgEl.textContent = 'Please enter your zip code.';
        msgEl.className = 'form-message form-message-error';
        return;
      }
      if (!zipRegex.test(zip)) {
        msgEl.textContent = 'Please enter a valid US zip code (e.g. 60601 or 60601-1234).';
        msgEl.className = 'form-message form-message-error';
        return;
      }

      msgEl.textContent = 'Searching for resources near ' + zip + '…';
      msgEl.className = 'form-message form-message-info';

      /* Simulate async lookup. Built with textContent (no innerHTML) so there is
         no HTML-injection surface. */
      setTimeout(function () {
        msgEl.textContent =
          'We found resources near ' + zip + '. A case coordinator will reach out ' +
          'within 24 hours. You can also call 1-800-555-0199 for immediate assistance.';
        msgEl.className = 'form-message form-message-success';
      }, 1200);
    });
  }
}());
