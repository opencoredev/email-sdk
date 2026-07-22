class EmailSdk < Formula
  desc "Lightweight TypeScript SDK and CLI for unified email sending"
  homepage "https://github.com/opencoredev/email-sdk"
  url "https://registry.npmjs.org/@opencoredev/email-sdk/-/email-sdk-1.0.0.tgz"
  sha256 "126b7b9525976d586b31c56a3ec49db2f373016946a3b417a2574bc04b6c7d8f"
  license "AGPL-3.0-only"

  depends_on "node"

  def install
    package_root = buildpath/"package"
    install_root = package_root.directory? ? package_root : buildpath

    libexec.install install_root.children
    bin.install_symlink libexec/"dist/cli.js" => "email-sdk"
  end

  test do
    assert_match "Email SDK adapters", shell_output("#{bin}/email-sdk adapters")
  end
end
