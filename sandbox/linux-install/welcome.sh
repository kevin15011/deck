export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
export PS1='sandbox:\w\$ '
printf '\nTemporary Deck installation sandbox. Runner versions at image build:\n'
cat "$HOME/runner-versions.txt"
if command -v deck-canary >/dev/null 2>&1; then
  printf '\nRun deck-canary to open the TUI.\n'
else
  printf '\nInstall Deck using its official command:\n'
  printf 'curl -fsSL https://raw.githubusercontent.com/kevin15011/deck/main/scripts/install.sh | bash\n'
fi
printf '\nExit this shell to delete the session and all its configuration.\n\n'
