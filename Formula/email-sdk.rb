class EmailSdk < Formula
  desc "Lightweight TypeScript SDK and CLI for unified email sending"
  homepage "https://github.com/opencoredev/email-sdk"
  url "https://registry.npmjs.org/@opencoredev/email-sdk/-/email-sdk-0.6.1.tgz"
  sha256 "6504a3446ddaf9b7e75c200f1a515f04c68d2c2a52015ddea61dbf2046fc5eb5"
  license "MIT"

  depends_on "bun"

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
