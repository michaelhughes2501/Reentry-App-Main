/* New Horizon — Landing Page JavaScript
   Vanilla JS, no dependencies, CSP-safe (no inline handlers).
*/

(function () {
  'use strict';

  /* ── Sticky nav ── */
  var nav = document.getElementById('site-nav');
  if (nav) {
    window.addEventListener('scroll', function () {
      nav.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  }

  /* ── Mobile nav toggle ── */
  var navToggle = document.querySelector('.nav-toggle');
  var navMobile = document.getElementById('nav-mobile');
  if (navToggle && navMobile) {
    navToggle.addEventListener('click', function () {
      navMobile.classList.toggle('open');
    });
  }

  /* Close mobile nav on link click ── */
  if (navMobile) {
    navMobile.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        navMobile.classList.remove('open');
      });
    });
  }

  /* ── Smooth scroll for all in-page anchor links ── */
  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var id = this.getAttribute('href');
      if (id === '#') return;
      var target = document.querySelector(id);
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
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  var ctaForm = document.getElementById('cta-form');
  if (ctaForm) {
    ctaForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var zip = document.getElementById('zip').value.trim();
      var msgEl = document.getElementById('form-message');

      if (!zip) {
        msgEl.textContent = 'Please enter your zip code.';
        msgEl.className = 'form-message form-message-error';
        return;
      }

      msgEl.textContent = 'Searching for resources near ' + escapeHtml(zip) + '...';
      msgEl.className = 'form-message form-message-info';

      /* Simulate async lookup */
      setTimeout(function () {
        msgEl.innerHTML =
          'We found resources near <strong>' + escapeHtml(zip) + '</strong>. ' +
          'A case coordinator will reach out within 24 hours. ' +
          'You can also call <strong>1-800-555-0199</strong> for immediate assistance.';
        msgEl.className = 'form-message form-message-success';
      }, 1200);
    });
  }
}());
