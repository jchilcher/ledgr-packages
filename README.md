# Ledgr Packages

Shared packages for the [Ledgr](https://github.com/jchilcher/ledgr-desktop) application ecosystem.

## Packages

| Package | Description |
| ------- | ----------- |
| `@ledgr/core` | Core business logic — forecast engine, parsers, and financial services |
| `@ledgr/db` | Database abstraction layer with driver support for better-sqlite3 and capacitor-sqlite |

## Usage

These packages are consumed as a git submodule by [ledgr-desktop](https://github.com/jchilcher/ledgr-desktop). To set up:

```bash
git submodule update --init
npm install
```

## Build

```bash
# Build all packages (core must build before db)
npm run build
```

## Support

If you find Ledgr useful, consider buying me a coffee:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-ffdd00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/jchilcher)

## License

MIT
