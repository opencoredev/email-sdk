class EmailSdk < Formula
  desc "Lightweight TypeScript SDK and CLI for unified email sending"
  homepage "https://github.com/opencoredev/email-sdk"
  url "https://registry.npmjs.org/@opencoredev/email-sdk/-/email-sdk-3.1.0.tgz"
  sha256 "c0867dafc7344ff175214841c0a41cef36eebb04cf242434b11aaf67c7c37b98"
  license "MIT"

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
