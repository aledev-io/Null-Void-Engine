import { fetchMarketplace, filterMarketplace } from './marketplace.js';

document.addEventListener('DOMContentLoaded', () => {
    fetchMarketplace();

    const searchInput = document.getElementById('marketplace-search');
    if (searchInput) searchInput.addEventListener('input', filterMarketplace);

    const typeFilter = document.getElementById('marketplace-filter-type');
    if (typeFilter) typeFilter.addEventListener('change', filterMarketplace);

    const statusFilter = document.getElementById('marketplace-filter-status');
    if (statusFilter) statusFilter.addEventListener('change', filterMarketplace);
});
