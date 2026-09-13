/**
 * Run this snippet in the browser console on any page to check for horizontal overflow.
 * It will highlight any elements that are causing the page to be wider than the viewport.
 */
function checkOverflow() {
  const docWidth = document.documentElement.scrollWidth;
  const clientWidth = document.documentElement.clientWidth;

  console.log(`Document scrollWidth: ${docWidth}px`);
  console.log(`Document clientWidth: ${clientWidth}px`);

  if (docWidth <= clientWidth) {
    console.log("PASS: No page-level horizontal overflow detected.");
    return;
  }

  console.warn(`FAIL: Page has horizontal overflow (${docWidth - clientWidth}px extra).`);

  // Find offenders
  const allElements = document.querySelectorAll('*');
  const offenders = [];

  for (const el of allElements) {
    // Check both viewport edges so fixed/popover content cannot be silently clipped.
    const rect = el.getBoundingClientRect();
    const rightEdge = rect.left + rect.width;

    // Only flag elements that are truly causing the overflow
    // and aren't intentionally scrolling (like overflow-x-auto containers)
    if ((rect.left < 0 || rightEdge > clientWidth) && el.scrollWidth <= el.clientWidth) {
      // Don't flag children if their parent is the real offender
      // but it's tricky to filter perfectly, so we just log them all
      // and highlight the most likely culprits

      const computed = window.getComputedStyle(el);
      // Ignore elements hidden or transparent
      if (computed.display !== 'none' && computed.opacity !== '0' && computed.visibility !== 'hidden') {
        offenders.push(el);
      }
    }
  }

  if (offenders.length === 0) {
    console.log("Couldn't identify specific elements causing the overflow.");
    return;
  }

  console.log(`Found ${offenders.length} elements extending past the viewport edge:`);

  // Filter out elements that are just parents of the real offenders to reduce noise
  const mainOffenders = offenders.filter(el => {
    // If none of its children are in the offenders list, it's a leaf offender
    return !Array.from(el.children).some(child => offenders.includes(child));
  });

  mainOffenders.forEach((el, index) => {
    console.log(`Offender ${index + 1}:`, el);

    // Highlight it visually
    const originalOutline = el.style.outline;
    const originalBackground = el.style.backgroundColor;

    el.style.outline = '2px solid red';
    el.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';

    // Restore after 3 seconds
    setTimeout(() => {
      el.style.outline = originalOutline;
      el.style.backgroundColor = originalBackground;
    }, 3000);
  });
}

// Check on load
console.log("Loaded QA Overflow Guard. Run checkOverflow() manually to test.");
// Uncomment to run automatically:
// checkOverflow();
