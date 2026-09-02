document.addEventListener('DOMContentLoaded', () => {
    const leagueSelect = document.getElementById('mflLeague');
    if (leagueSelect && typeof SFB16_LEAGUES !== 'undefined') {
        SFB16_LEAGUES.forEach(league => {
            const option = document.createElement('option');
            option.value = league.id;
            option.textContent = league.name;
            leagueSelect.appendChild(option);
        });
    }
});
