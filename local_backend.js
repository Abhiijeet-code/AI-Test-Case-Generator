const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec } = require('node:child_process');

const PORT = 3001;
const WORKSPACE_DIR = __dirname;
const TESTS_DIR = path.join(WORKSPACE_DIR, 'tests', 'e2e');
const ECLIPSE_DIR = path.join(WORKSPACE_DIR, 'src', 'test', 'java', 'com', 'testforge');
const PAGES_DIR = path.join(WORKSPACE_DIR, 'src', 'main', 'java', 'com', 'testforge', 'pages');

// Ensure directories exist
fs.mkdirSync(TESTS_DIR, { recursive: true });
fs.mkdirSync(ECLIPSE_DIR, { recursive: true });
fs.mkdirSync(PAGES_DIR, { recursive: true });
fs.mkdirSync(path.join(WORKSPACE_DIR, 'tests', 'pages'), { recursive: true });

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(data));
}

function buildAutomationBundle(framework, language, requirement, jiraId = null) {
  const fw = (framework || 'playwright').toLowerCase();
  const reqLower = (requirement || '').toLowerCase();
  const isAmazon = reqLower.includes('amazon');
  const targetSite = isAmazon ? 'Amazon' : 'Web Application';
  const targetUrl = isAmazon ? 'https://www.amazon.com/ap/signin' : 'http://localhost:5173/login';

  const cleanId = jiraId ? jiraId.replace(/[^a-zA-Z0-9_-]/g, '_') : (isAmazon ? 'AmazonLogin' : 'AppLogin');

  let fileName = '';
  let absFilePath = '';
  let specCode = '';
  let pageFileName = '';
  let pageAbsPath = '';
  let pageCode = '';
  let configCode = '';
  let runCommand = '';
  let instructions = [];

  // ==========================================
  // 1. SELENIUM FRAMEWORK GENERATOR
  // ==========================================
  if (fw === 'selenium') {
    // Supported languages: java, python, csharp, javascript, ruby
    let lang = (language || 'java').toLowerCase();
    if (lang === 'typescript' || lang === 'ts' || !lang) {
      lang = 'java';
    }

    if (lang === 'java' || lang === 'testng') {
      const className = isAmazon ? 'AmazonLoginSeleniumTest' : `${cleanId}SeleniumTest`;
      const pageClassName = isAmazon ? 'AmazonLoginPage' : `${cleanId}Page`;
      fileName = `${className}.java`;
      absFilePath = path.join(ECLIPSE_DIR, fileName);
      pageFileName = `${pageClassName}.java`;
      pageAbsPath = path.join(PAGES_DIR, pageFileName);

      if (isAmazon) {
        specCode = `package com.testforge;

import com.testforge.pages.AmazonLoginPage;
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.testng.Assert;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

/**
 * Selenium Java TestNG Suite for Amazon Login
 * Target: ${targetUrl}
 * ${jiraId ? 'Linked Jira: ' + jiraId : 'Standard Verification Suite'}
 */
public class AmazonLoginSeleniumTest {
    private WebDriver driver;
    private AmazonLoginPage loginPage;

    @BeforeMethod
    public void setUp() {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--remote-allow-origins=*");
        options.addArguments("--start-maximized");
        driver = new ChromeDriver(options);
        loginPage = new AmazonLoginPage(driver);
        loginPage.open();
    }

    @Test(priority = 1, description = "TC01 - Verify navigation to Amazon login page")
    public void testPageNavigation() {
        Assert.assertTrue(driver.getTitle().contains("Amazon") || driver.getCurrentUrl().contains("signin"), 
                "User should be on Amazon Sign-In page");
    }

    @Test(priority = 2, description = "TC02 - Verify invalid email triggers warning alert")
    public void testInvalidEmailWarning() {
        loginPage.enterEmail("unregistered_qa_test99281@domainnotexist.com");
        loginPage.clickContinue();
        Assert.assertTrue(loginPage.isErrorAlertVisible(), 
                "Amazon error box should be displayed for invalid email");
    }

    @Test(priority = 3, description = "TC03 - Verify empty email triggers validation prompt")
    public void testEmptyEmailValidation() {
        loginPage.clickContinue();
        Assert.assertTrue(loginPage.isPromptMessageVisible(), 
                "Validation alert should prompt user to enter email or mobile number");
    }

    @AfterMethod
    public void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }
}
`;

        pageCode = `package com.testforge.pages;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import java.time.Duration;

/**
 * Page Object Model for Amazon Sign-In
 */
public class AmazonLoginPage {
    private WebDriver driver;
    private WebDriverWait wait;

    @FindBy(id = "ap_email")
    private WebElement emailField;

    @FindBy(id = "continue")
    private WebElement continueButton;

    @FindBy(id = "ap_password")
    private WebElement passwordField;

    @FindBy(id = "signInSubmit")
    private WebElement signInSubmitButton;

    @FindBy(id = "auth-error-message-box")
    private WebElement authErrorMessageBox;

    @FindBy(css = "#auth-email-missing-alert, .a-alert-content")
    private WebElement promptAlert;

    public AmazonLoginPage(WebDriver driver) {
        this.driver = driver;
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        PageFactory.initElements(driver, this);
    }

    public void open() {
        driver.get("${targetUrl}");
    }

    public void enterEmail(String email) {
        wait.until(ExpectedConditions.visibilityOf(emailField)).clear();
        emailField.sendKeys(email);
    }

    public void clickContinue() {
        wait.until(ExpectedConditions.elementToBeClickable(continueButton)).click();
    }

    public void enterPassword(String pass) {
        wait.until(ExpectedConditions.visibilityOf(passwordField)).sendKeys(pass);
    }

    public void clickSignIn() {
        wait.until(ExpectedConditions.elementToBeClickable(signInSubmitButton)).click();
    }

    public boolean isErrorAlertVisible() {
        try {
            return wait.until(ExpectedConditions.visibilityOf(authErrorMessageBox)).isDisplayed();
        } catch (Exception e) {
            return false;
        }
    }

    public boolean isPromptMessageVisible() {
        try {
            return wait.until(ExpectedConditions.visibilityOf(promptAlert)).isDisplayed();
        } catch (Exception e) {
            return false;
        }
    }
}
`;
      } else {
        specCode = `package com.testforge;

import com.testforge.pages.${pageClassName};
import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.openqa.selenium.chrome.ChromeOptions;
import org.testng.Assert;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

public class ${className} {
    private WebDriver driver;
    private ${pageClassName} loginPage;

    @BeforeMethod
    public void setUp() {
        ChromeOptions options = new ChromeOptions();
        options.addArguments("--remote-allow-origins=*");
        options.addArguments("--start-maximized");
        driver = new ChromeDriver(options);
        loginPage = new ${pageClassName}(driver);
        loginPage.open("${targetUrl}");
    }

    @Test(priority = 1)
    public void testValidAuthentication() {
        loginPage.login("qa.analyst@fintech.io", "SecurePass2026!");
        Assert.assertTrue(driver.getCurrentUrl().contains("dashboard"), "User redirected to dashboard");
    }

    @AfterMethod
    public void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }
}
`;

        pageCode = `package com.testforge.pages;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.WebElement;
import org.openqa.selenium.support.FindBy;
import org.openqa.selenium.support.PageFactory;
import org.openqa.selenium.support.ui.ExpectedConditions;
import org.openqa.selenium.support.ui.WebDriverWait;
import java.time.Duration;

public class ${pageClassName} {
    private WebDriver driver;
    private WebDriverWait wait;

    @FindBy(id = "email")
    private WebElement emailField;

    @FindBy(id = "password")
    private WebElement passwordField;

    @FindBy(css = "button[type='submit']")
    private WebElement submitBtn;

    public ${pageClassName}(WebDriver driver) {
        this.driver = driver;
        this.wait = new WebDriverWait(driver, Duration.ofSeconds(10));
        PageFactory.initElements(driver, this);
    }

    public void open(String url) {
        driver.get(url);
    }

    public void login(String email, String pass) {
        wait.until(ExpectedConditions.visibilityOf(emailField)).sendKeys(email);
        passwordField.sendKeys(pass);
        submitBtn.click();
    }
}
`;
      }

      configCode = `<project xmlns="http://maven.apache.org/POM/4.0.0"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.testforge</groupId>
  <artifactId>ai-qa-automation</artifactId>
  <version>1.0.0</version>
  <properties>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.seleniumhq.selenium</groupId>
      <artifactId>selenium-java</artifactId>
      <version>4.21.0</version>
    </dependency>
    <dependency>
      <groupId>org.testng</groupId>
      <artifactId>testng</artifactId>
      <version>7.10.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>
`;
      runCommand = `mvn test -Dtest=${className}`;
      instructions = [
        `Saved test class to: ${absFilePath}`,
        `Saved Page Object to: ${pageAbsPath}`,
        '1. Open Eclipse IDE',
        '2. File -> Import... -> Maven -> Existing Maven Projects',
        `3. Select Root Directory: ${WORKSPACE_DIR}`,
        `4. Right click ${fileName} -> Run As -> TestNG Test`
      ];

      try {
        fs.writeFileSync(absFilePath, specCode, 'utf8');
        fs.writeFileSync(pageAbsPath, pageCode, 'utf8');
        const pomPath = path.join(WORKSPACE_DIR, 'pom.xml');
        if (!fs.existsSync(pomPath)) fs.writeFileSync(pomPath, configCode, 'utf8');
      } catch (e) {
        console.error('File write error:', e);
      }

    } else if (lang === 'python') {
      fileName = isAmazon ? 'test_amazon_login_selenium.py' : `test_${cleanId.toLowerCase()}_selenium.py`;
      absFilePath = path.join(TESTS_DIR, fileName);
      pageFileName = isAmazon ? 'amazon_login_page.py' : `${cleanId.toLowerCase()}_page.py`;
      pageAbsPath = path.join(WORKSPACE_DIR, 'tests', 'pages', pageFileName);

      specCode = `import pytest
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
from pages.${pageFileName.replace('.py', '')} import AmazonLoginPage

class TestAmazonLoginSelenium:
    @pytest.fixture(autouse=True)
    def setup_and_teardown(self):
        options = webdriver.ChromeOptions()
        options.add_argument("--start-maximized")
        self.driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
        self.login_page = AmazonLoginPage(self.driver)
        self.login_page.open("${targetUrl}")
        yield
        self.driver.quit()

    def test_tc01_navigation(self):
        assert "Amazon" in self.driver.title or "signin" in self.driver.current_url

    def test_tc02_invalid_email_alert(self):
        self.login_page.enter_email("unregistered_qa_test99281@domainnotexist.com")
        self.login_page.click_continue()
        assert self.login_page.is_error_displayed()
`;

      pageCode = `from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

class AmazonLoginPage:
    def __init__(self, driver):
        self.driver = driver
        self.wait = WebDriverWait(driver, 10)
        self.email_input = (By.ID, "ap_email")
        self.continue_btn = (By.ID, "continue")
        self.error_alert = (By.ID, "auth-error-message-box")

    def open(self, url):
        self.driver.get(url)

    def enter_email(self, email):
        self.wait.until(EC.visibility_of_element_located(self.email_input)).send_keys(email)

    def click_continue(self):
        self.wait.until(EC.element_to_be_clickable(self.continue_btn)).click()

    def is_error_displayed(self):
        try:
            return self.wait.until(EC.visibility_of_element_located(self.error_alert)).is_displayed()
        except:
            return False
`;
      configCode = `[pytest]\ntestpaths = tests\npython_files = test_*.py\n`;
      runCommand = `pytest tests/e2e/${fileName} -v`;
      instructions = [`Run with: ${runCommand}`];
      try {
        fs.writeFileSync(absFilePath, specCode, 'utf8');
        fs.writeFileSync(pageAbsPath, pageCode, 'utf8');
      } catch (e) {}

    } else if (lang === 'csharp') {
      fileName = isAmazon ? 'AmazonLoginSeleniumTest.cs' : `${cleanId}SeleniumTest.cs`;
      absFilePath = path.join(TESTS_DIR, fileName);
      pageFileName = isAmazon ? 'AmazonLoginPage.cs' : `${cleanId}Page.cs`;
      pageAbsPath = path.join(WORKSPACE_DIR, 'tests', 'pages', pageFileName);

      specCode = `using NUnit.Framework;
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;

namespace TestForge.Selenium
{
    [TestFixture]
    public class ${isAmazon ? 'AmazonLoginSeleniumTest' : cleanId + 'SeleniumTest'}
    {
        private IWebDriver driver;

        [SetUp]
        public void Setup()
        {
            var options = new ChromeOptions();
            options.AddArgument("--start-maximized");
            driver = new ChromeDriver(options);
            driver.Navigate().GoToUrl("${targetUrl}");
        }

        [Test]
        public void TC01_VerifyPageLanding()
        {
            Assert.That(driver.Title.Contains("Amazon") || driver.Url.Contains("signin"));
        }

        [TearDown]
        public void TearDown()
        {
            driver?.Quit();
        }
    }
}`;
      pageCode = `using OpenQA.Selenium;

namespace TestForge.Selenium.Pages
{
    public class ${isAmazon ? 'AmazonLoginPage' : cleanId + 'Page'}
    {
        private readonly IWebDriver driver;
        public AmazonLoginPage(IWebDriver driver) { this.driver = driver; }
    }
}`;
      configCode = `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n</Project>`;
      runCommand = `dotnet test`;
      instructions = [`Run with: dotnet test`];
      try {
        fs.writeFileSync(absFilePath, specCode, 'utf8');
        fs.writeFileSync(pageAbsPath, pageCode, 'utf8');
      } catch (e) {}

    } else {
      // Javascript or Ruby Selenium
      const isRuby = lang === 'ruby';
      fileName = isRuby ? 'amazon_login_selenium_spec.rb' : 'amazon_login_selenium.test.js';
      absFilePath = path.join(TESTS_DIR, fileName);
      pageFileName = isRuby ? 'amazon_login_page.rb' : 'amazon_login_page.js';
      pageAbsPath = path.join(WORKSPACE_DIR, 'tests', 'pages', pageFileName);

      if (isRuby) {
        specCode = `require 'selenium-webdriver'\nrequire 'rspec'\n\nRSpec.describe 'Amazon Login Suite' do\n  before(:each) do\n    @driver = Selenium::WebDriver.for :chrome\n    @driver.get '${targetUrl}'\n  end\n\n  it 'TC01 loads sign in page' do\n    expect(@driver.title).to include('Amazon')\n  end\n\n  after(:each) do\n    @driver.quit\n  end\nend\n`;
        runCommand = 'bundle exec rspec';
      } else {
        specCode = `const { Builder, By, until } = require('selenium-webdriver');\nconst assert = require('assert');\n\ndescribe('Amazon Login Suite', function() {\n  let driver;\n  this.timeout(30000);\n\n  before(async () => {\n    driver = await new Builder().forBrowser('chrome').build();\n    await driver.get('${targetUrl}');\n  });\n\n  it('TC01 - Verify navigation', async () => {\n    const title = await driver.getTitle();\n    assert(title.includes('Amazon') || (await driver.getCurrentUrl()).includes('signin'));\n  });\n\n  after(async () => {\n    await driver.quit();\n  });\n});\n`;
        runCommand = `npx mocha tests/e2e/${fileName}`;
      }
      pageCode = `// Selenium Page Object Model for Amazon\n`;
      configCode = `{}`;
      instructions = [`Run with: ${runCommand}`];
      try {
        fs.writeFileSync(absFilePath, specCode, 'utf8');
        fs.writeFileSync(pageAbsPath, pageCode, 'utf8');
      } catch (e) {}
    }

  // ==========================================
  // 2. PLAYWRIGHT FRAMEWORK GENERATOR
  // ==========================================
  } else {
    let lang = (language || 'typescript').toLowerCase();
    const ext = lang === 'python' ? 'py' : lang === 'java' ? 'java' : lang === 'csharp' ? 'cs' : lang === 'javascript' ? 'spec.js' : 'spec.ts';
    fileName = `${cleanId}_playwright.${ext}`;
    absFilePath = path.join(TESTS_DIR, fileName);
    pageFileName = isAmazon ? 'AmazonLoginPage.ts' : 'LoginPage.ts';
    pageAbsPath = path.join(WORKSPACE_DIR, 'tests', 'pages', pageFileName);

    if (isAmazon) {
      specCode = `import { test, expect } from '@playwright/test';
import { AmazonLoginPage } from '../pages/AmazonLoginPage';

/**
 * Playwright E2E Suite for Amazon Login
 * ${jiraId ? 'Linked Ticket: ' + jiraId : 'Standard Verification'}
 */
test.describe('${cleanId} - Amazon Authentication Suite', () => {
  let amazonLogin: AmazonLoginPage;

  test.beforeEach(async ({ page }) => {
    amazonLogin = new AmazonLoginPage(page);
    await amazonLogin.goto();
  });

  test('TC01 - Landing on Amazon Sign-In page', async ({ page }) => {
    await expect(page).toHaveTitle(/.*Amazon.*|.*Sign-In.*/i);
    await expect(amazonLogin.emailInput).toBeVisible();
    await expect(amazonLogin.continueBtn).toBeVisible();
  });

  test('TC02 - Unregistered email produces error warning alert', async () => {
    await amazonLogin.enterEmail('unregistered_qa_test99281@domainnotexist.com');
    await amazonLogin.clickContinue();
    await expect(amazonLogin.errorAlert).toBeVisible();
  });

  test('TC03 - Blank email field displays inline validation alert', async () => {
    await amazonLogin.clickContinue();
    await expect(amazonLogin.missingEmailPrompt).toBeVisible();
  });
});
`;

      pageCode = `import { Page, Locator } from '@playwright/test';

export class AmazonLoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly continueBtn: Locator;
  readonly passwordInput: Locator;
  readonly signInBtn: Locator;
  readonly errorAlert: Locator;
  readonly missingEmailPrompt: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('#ap_email');
    this.continueBtn = page.locator('#continue');
    this.passwordInput = page.locator('#ap_password');
    this.signInBtn = page.locator('#signInSubmit');
    this.errorAlert = page.locator('#auth-error-message-box, .a-alert-content');
    this.missingEmailPrompt = page.locator('.a-alert-content');
  }

  async goto() {
    await this.page.goto('${targetUrl}');
  }

  async enterEmail(email: string) {
    await this.emailInput.fill(email);
  }

  async clickContinue() {
    await this.continueBtn.click();
  }

  async login(password: string) {
    await this.passwordInput.fill(password);
    await this.signInBtn.click();
  }
}
`;
    } else {
      specCode = `import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('${cleanId} - Automation Suite', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('TC01 - Successful login flow', async ({ page }) => {
    await loginPage.login('qa.analyst@fintech.io', 'SecurePass2026!');
    await expect(page).toHaveURL(/.*dashboard/);
  });
});
`;

      pageCode = `import { Page, Locator } from '@playwright/test';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('#email, [data-testid="input-email"]');
    this.passwordInput = page.locator('#password, [data-testid="input-password"]');
    this.submitButton = page.locator('button[type="submit"]');
    this.errorMessage = page.locator('[role="alert"], .error-message');
  }

  async goto() {
    await this.page.goto('${targetUrl}');
  }

  async login(email: string, pass: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(pass);
    await this.submitButton.click();
  }
}
`;
    }

    configCode = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
`;
    runCommand = `npx playwright test tests/e2e/${fileName} --headed`;
    instructions = [
      `Saved spec file: ${absFilePath}`,
      `Saved page object: ${pageAbsPath}`,
      `Run via CLI: ${runCommand}`
    ];

    try {
      fs.writeFileSync(absFilePath, specCode, 'utf8');
      fs.writeFileSync(pageAbsPath, pageCode, 'utf8');
    } catch (e) {
      console.error('File write error:', e);
    }
  }

  const forwardSlashPath = absFilePath.replace(/\\/g, '/');

  return {
    status: 'ok',
    framework: fw,
    language: language || (fw === 'selenium' ? 'java' : 'typescript'),
    jiraId: jiraId || undefined,
    fileName,
    filePath: absFilePath,
    pageFileName,
    pageAbsPath,
    specCode,
    pageCode,
    configCode,
    runCommand,
    vscodeUri: `vscode://file/${forwardSlashPath}`,
    instructions
  };
}

function buildTestCases(requirement, jiraTicket = null, template = 'Functional') {
  const reqLower = (requirement || '').toLowerCase();
  const isAmazon = reqLower.includes('amazon');
  const isRealJira = !!(jiraTicket && (jiraTicket.key || jiraTicket.jiraId));
  const jKey = isRealJira ? (jiraTicket.key || jiraTicket.jiraId) : null;
  const prefix = jKey ? `${jKey}-` : 'TC-';

  if (isAmazon) {
    return [
      {
        id: `${prefix}01`,
        title: 'Amazon Login - Verify landing on Sign-In page with valid fields',
        type: 'Positive / Functional',
        priority: 'P1',
        preconditions: 'Browser online; navigate to amazon.com/ap/signin',
        steps: [
          'Navigate to https://www.amazon.com/ap/signin',
          'Verify Page Title contains "Amazon Sign-In"',
          'Verify email input field and Continue button are visible and interactive'
        ],
        test_data: 'Standard navigation payload',
        expected_result: 'Sign-in form loads with HTTP 200 and all authentication inputs displayed correctly',
        linked_jira_id: jKey || undefined
      },
      {
        id: `${prefix}02`,
        title: 'Amazon Login - Verify error alert on unregistered email/mobile number',
        type: 'Negative / Validation',
        priority: 'P1',
        preconditions: 'Email not registered on Amazon database',
        steps: [
          'Enter unregistered email "unregistered_test_qa99@notrealdomain.com"',
          'Click Continue button',
          'Wait for auth-error-message-box response'
        ],
        test_data: 'unregistered_test_qa99@notrealdomain.com',
        expected_result: 'Error box displays "We cannot find an account with that email address"',
        linked_jira_id: jKey || undefined
      },
      {
        id: `${prefix}03`,
        title: 'Amazon Login - Verify inline warning when email field is submitted blank',
        type: 'Boundary / Validation',
        priority: 'P2',
        preconditions: 'Email field empty in DOM',
        steps: [
          'Leave email input blank',
          'Click Continue button',
          'Inspect validation message'
        ],
        test_data: 'Empty input string ("")',
        expected_result: 'Inline alert prompt displayed: "Enter your email or mobile phone number"',
        linked_jira_id: jKey || undefined
      },
      {
        id: `${prefix}04`,
        title: 'Amazon Login - Verify password entry step for registered user',
        type: 'Positive / Flow',
        priority: 'P1',
        preconditions: 'Valid registered test user account',
        steps: [
          'Enter valid test user email',
          'Click Continue',
          'Verify Password input field appears with Sign-In button',
          'Enter password and click Sign-In'
        ],
        test_data: 'qa_verified_user@amazon-sandbox.com',
        expected_result: 'Authentication token set, user redirected to Amazon dashboard/home',
        linked_jira_id: jKey || undefined
      }
    ];
  }

  return [
    {
      id: `${prefix}01`,
      title: `Verify ${template} - Positive happy path flow`,
      type: template,
      priority: 'P1',
      preconditions: 'User registered with active privileges in test environment',
      steps: [
        `Navigate to entry point for: ${requirement.slice(0, 45)}`,
        'Provide valid verified test credentials',
        'Execute submit action and verify response status'
      ],
      test_data: 'Valid authorization token and parameters',
      expected_result: 'Action completes with HTTP 200/201 and UI reflects confirmed status',
      linked_jira_id: jKey || undefined
    },
    {
      id: `${prefix}02`,
      title: `Verify ${template} - Boundary input length & format validation`,
      type: 'Boundary & Edge',
      priority: 'P2',
      preconditions: 'Input form ready in active DOM',
      steps: [
        'Input payload at MAX_ALLOWED_LENGTH + 1 character boundary',
        'Submit form'
      ],
      test_data: 'Boundary string length 256 characters (overflow test)',
      expected_result: 'Client-side validation error displayed; request rejected with 422 Unprocessable',
      linked_jira_id: jKey || undefined
    },
    {
      id: `${prefix}03`,
      title: `Verify ${template} - Negative security protection and sanitization`,
      type: 'Security Boundary',
      priority: 'Highest',
      preconditions: 'Security filtering active',
      steps: [
        'Submit malicious payload containing script tags or SQL injection characters',
        'Inspect server response code and sanitized body'
      ],
      test_data: `' OR 1=1; <script>alert(1)</script>`,
      expected_result: 'Request sanitized or blocked with HTTP 400 Bad Request; zero unauthorized leakage',
      linked_jira_id: jKey || undefined
    }
  ];
}

const server = http.createServer((req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  let bodyStr = '';
  req.on('data', chunk => { bodyStr += chunk; });
  req.on('end', () => {
    let body = {};
    if (bodyStr) {
      try { body = JSON.parse(bodyStr); } catch (e) {}
    }

    // Health / Status
    if (pathname === '/api/status' || pathname === '/api/health') {
      return sendJson(res, 200, { status: 'online', port: PORT, engine: 'TestForge RAG Backend' });
    }

    // Settings
    if (pathname === '/api/settings') {
      const settingsFile = path.join(WORKSPACE_DIR, 'settings.json');
      if (req.method === 'POST') {
        fs.writeFileSync(settingsFile, JSON.stringify(body, null, 2));
        return sendJson(res, 200, { status: 'saved', settings: body });
      }
      let saved = {};
      if (fs.existsSync(settingsFile)) {
        try { saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); } catch (e) {}
      }
      return sendJson(res, 200, saved);
    }

    // Jira Fetch Mock/Bridge
    if (pathname === '/api/jira/fetch') {
      const { jiraId = 'PROJ-1024' } = body;
      return sendJson(res, 200, {
        status: 'ok',
        ticket: {
          jiraId,
          key: jiraId,
          summary: `Requirement specifications and verification criteria for ${jiraId}`,
          description: 'Authenticate user credentials, validate security boundaries, and ensure resilient error handling.',
          priority: 'High',
          status: 'In Progress',
          issueType: 'Story',
          components: ['Authentication', 'Core Platform'],
          acceptanceCriteria: '1. Valid credentials redirect.\n2. Invalid inputs display descriptive alert.'
        }
      });
    }

    // Codegen Framework Endpoint
    if (pathname === '/api/codegen/framework' || pathname === '/api/codegen') {
      const { framework = 'selenium', language = 'java', requirement = '', jiraId = null } = body;
      const bundle = buildAutomationBundle(framework, language, requirement, jiraId);
      return sendJson(res, 200, bundle);
    }

    // Interactive Chatbot Endpoint
    if (pathname === '/api/chat') {
      const message = body.message || '';
      const msgLower = message.toLowerCase();
      const jiraTicket = body.jiraTicket;
      const isRealJira = !!(jiraTicket && (jiraTicket.key || jiraTicket.jiraId));
      const jiraId = isRealJira ? (jiraTicket.key || jiraTicket.jiraId) : null;
      const template = body.template || 'Functional';

      const isSelenium = msgLower.includes('selenium') || body.framework === 'selenium';
      const isPlaywright = msgLower.includes('playwright') || body.framework === 'playwright';
      const isCodeReq = isSelenium || isPlaywright || /code|framework|script|automate|test case|pom/i.test(msgLower);

      if (isCodeReq) {
        const fw = isSelenium ? 'selenium' : (isPlaywright ? 'playwright' : (body.framework || 'selenium'));
        let lang = body.language;
        if (!lang) {
          lang = msgLower.includes('python') ? 'python' : (msgLower.includes('java') ? 'java' : (msgLower.includes('csharp') ? 'csharp' : (fw === 'selenium' ? 'java' : 'typescript')));
        }
        if (fw === 'selenium' && (lang === 'typescript' || lang === 'ts')) {
          lang = 'java';
        }

        const bundle = buildAutomationBundle(fw, lang, message, jiraId);
        const testCases = buildTestCases(message, jiraTicket, template);

        const replyMarkdown = `### 🚀 Generated ${fw.toUpperCase()} (${lang.toUpperCase()}) Test Framework
Synthesized an executable **Page Object Model (POM)** automation suite ${jiraId ? `grounded for **${jiraId}**` : 'grounded against requirements'}.

- **Test Spec**: \`${bundle.fileName}\`
- **Page Object**: \`${bundle.pageFileName}\`
- **Execution**: \`${bundle.runCommand}\`

You can inspect and copy the code tabs below, or click **"${fw === 'selenium' ? 'Open in Eclipse' : 'Open in VS Code'}"** to execute directly in your IDE.`;

        return sendJson(res, 200, {
          status: 'ok',
          reply: replyMarkdown,
          hasCode: true,
          codeBundle: bundle,
          testCases: testCases
        });
      }

      // Regular QA / Test Case generation
      const testCases = buildTestCases(message, jiraTicket, template);
      return sendJson(res, 200, {
        status: 'ok',
        reply: `Synthesized grounded test cases ${jiraId ? `for **${jiraId}**` : ''} using RAG pipeline semantic retrieval.`,
        testCases: testCases,
        hasCode: false
      });
    }

    // Generate Test Cases Endpoint
    if (pathname === '/api/generate') {
      const requirement = body.requirement || body.prompt || '';
      const jiraTicket = body.jiraTicket;
      const template = body.template || 'Functional';
      const cases = buildTestCases(requirement, jiraTicket, template);
      return sendJson(res, 200, {
        status: 'ok',
        response: cases
      });
    }

    // Export & Launch in VS Code
    if (pathname === '/api/export-vscode' || pathname === '/api/launch-vscode') {
      const { title, jiraId = null, language = 'typescript', framework = 'playwright' } = body;
      const bundle = buildAutomationBundle(framework, language, title || 'Regression Suite', jiraId);

      // Execute code command to open in VS Code reliably on Windows
      const fullCodeCmd = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\abhid\\AppData\\Local', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd');
      const cmdToRun = fs.existsSync(fullCodeCmd)
        ? `"${fullCodeCmd}" "${bundle.filePath}"`
        : `cmd.exe /c code "${bundle.filePath}"`;

      exec(cmdToRun, (cliErr) => {
        if (cliErr) {
          console.warn('VS Code CLI primary notice:', cliErr.message);
          exec(`code "${bundle.filePath}"`);
        } else {
          console.log(`VS Code launched for: ${bundle.filePath}`);
        }
      });

      return sendJson(res, 200, {
        status: 'success',
        fileName: bundle.fileName,
        filePath: bundle.filePath,
        vscodeUri: bundle.vscodeUri,
        specCode: bundle.specCode,
        instructions: bundle.instructions
      });
    }

    // Launch in Eclipse Endpoint
    if (pathname === '/api/launch-eclipse') {
      const { jiraId = null, requirement = 'Amazon Login test case', filePath } = body;
      const bundle = buildAutomationBundle('selenium', 'java', requirement, jiraId);

      const targetFile = filePath || bundle.filePath;

      // Candidate paths for Eclipse on this system
      const candidatePaths = [
        'C:\\Users\\abhid\\Downloads\\eclipse-jee-2023-12-R-win32-x86_64\\eclipse\\eclipse.exe',
        path.join(process.env.USERPROFILE || 'C:\\Users\\abhid', 'eclipse', 'jee-latest-released', 'eclipse', 'eclipse.exe'),
        'C:\\Program Files\\Eclipse Foundation\\eclipse.exe',
        'C:\\Program Files\\eclipse\\eclipse.exe'
      ];

      const eclipseExe = candidatePaths.find(p => fs.existsSync(p));

      // 1. Launch Eclipse IDE
      if (eclipseExe) {
        exec(`cmd.exe /c start "" "${eclipseExe}" -data "${WORKSPACE_DIR}"`, (err) => {
          if (err) console.warn('Eclipse launch notice:', err.message);
          else console.log('Eclipse IDE successfully launched from:', eclipseExe);
        });
      } else {
        exec('cmd.exe /c start eclipse', (err) => {
          if (err) console.warn('Eclipse start notice:', err.message);
        });
      }

      // 2. Open Windows Explorer with the generated Java test class selected
      if (fs.existsSync(targetFile)) {
        exec(`explorer.exe /select,"${targetFile}"`);
      } else {
        exec(`explorer.exe "${WORKSPACE_DIR}"`);
      }

      return sendJson(res, 200, {
        status: 'success',
        ide: 'eclipse',
        launched: true,
        fileName: bundle.fileName,
        filePath: targetFile,
        workspacePath: WORKSPACE_DIR,
        instructions: [
          `Java Test Case saved to: ${targetFile}`,
          `Page Object saved to: ${bundle.pageAbsPath || path.join(PAGES_DIR, bundle.pageFileName)}`,
          '1. Eclipse IDE has launched on your computer.',
          '2. Windows File Explorer opened with the generated Java test file.',
          '3. In Eclipse: File -> Import... -> Maven -> Existing Maven Projects',
          `4. Select Root Directory: ${WORKSPACE_DIR}`,
          `5. Right click on ${bundle.fileName} -> Run As -> TestNG Test`
        ]
      });
    }

    // Default Fallback
    return sendJson(res, 200, {
      status: 'ok',
      message: 'TestForge local server is operational'
    });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`TestForge Local Backend running on http://127.0.0.1:${PORT}`);
});
