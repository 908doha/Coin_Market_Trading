// Root-level re-export so navigating from the home tab to a position
// detail screen stays within the root Stack (not inside the tab Stack),
// which means pressing back returns to the previously active tab
// instead of switching to the positions tab.
import Component from '../(main)/positions/[id]';
export default Component;
