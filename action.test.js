jest.mock('got');
jest.mock('@actions/core');
jest.mock('@actions/core/lib/command');

const core = require('@actions/core');
const got = require('got');
const {
    exportSecrets,
    parseSecretsInput,
    parseResponse,
    parseHeadersInput
} = require('./action');

const { when } = require('jest-when');

describe('parseSecretsInput', () => {
    it('parses simple secret', () => {
        const output = parseSecretsInput('test key');
        expect(output).toContainEqual({
            secretPath: 'test',
            secretSelector: 'key',
            outputVarName: 'key',
            envVarName: 'KEY',
            isJSONPath: false
        });
    });

    it('parses mapped secret', () => {
        const output = parseSecretsInput('test key|testName');
        expect(output).toHaveLength(1);
        expect(output[0]).toMatchObject({
            outputVarName: 'testName',
            envVarName: 'testName',
        });
    });

    it('fails on invalid mapped name', () => {
        expect(() => parseSecretsInput('test key|'))
            .toThrowError(`You must provide a value when mapping a secret to a name. Input: "test key|"`)
    });

    it('fails on invalid path for mapped', () => {
        expect(() => parseSecretsInput('|testName'))
            .toThrowError(`You must provide a valid path and key. Input: "|testName"`)
    });

    it('parses multiple secrets', () => {
        const output = parseSecretsInput('first a;second b;');

        expect(output).toHaveLength(2);
        expect(output[0]).toMatchObject({
            secretPath: 'first',
        });
        expect(output[1]).toMatchObject({
            secretPath: 'second',
        });
    });

    it('parses multiple complex secret input', () => {
        const output = parseSecretsInput('first a;second b|secondName');

        expect(output).toHaveLength(2);
        expect(output[0]).toMatchObject({
            outputVarName: 'a',
            envVarName: 'A',
        });
        expect(output[1]).toMatchObject({
            outputVarName: 'secondName',
            envVarName: 'secondName'
        });
    });

    it('parses multiline input', () => {
        const output = parseSecretsInput(`
        first a;
        second b;
        third c | SOME_C;`);

        expect(output).toHaveLength(3);
        expect(output[0]).toMatchObject({
            secretPath: 'first',
        });
        expect(output[1]).toMatchObject({
            outputVarName: 'b',
            envVarName: 'B'
        });
        expect(output[2]).toMatchObject({
            outputVarName: 'SOME_C',
            envVarName: 'SOME_C',
        });
    })
});

describe('parseHeaders', () => {
    it('parses simple header', () => {
        when(core.getInput)
            .calledWith('extraHeaders')
            .mockReturnValueOnce('TEST: 1');
        const result = parseHeadersInput('extraHeaders');
        expect(Array.from(result)).toContainEqual(['test', '1']);
    });

    it('parses simple header with whitespace', () => {
        when(core.getInput)
            .calledWith('extraHeaders')
            .mockReturnValueOnce(`
            TEST: 1
            `);
        const result = parseHeadersInput('extraHeaders');
        expect(Array.from(result)).toContainEqual(['test', '1']);
    });

    it('parses multiple headers', () => {
        when(core.getInput)
            .calledWith('extraHeaders')
            .mockReturnValueOnce(`
            TEST: 1
            FOO: bAr
            `);
        const result = parseHeadersInput('extraHeaders');
        expect(Array.from(result)).toContainEqual(['test', '1']);
        expect(Array.from(result)).toContainEqual(['foo', 'bAr']);
    });

    it('parses null response', () => {
        when(core.getInput)
            .calledWith('extraHeaders')
            .mockReturnValueOnce(null);
        const result = parseHeadersInput('extraHeaders');
        expect(Array.from(result)).toHaveLength(0);
    });
})

describe('parseResponse', () => {
    // https://www.vaultproject.io/api/secret/kv/kv-v1.html#sample-response
    it('parses K/V version 1 response', () => {
        const response = JSON.stringify({
            data: {
                foo: 'bar'
            }
        })
        const output = parseResponse(response, 1);

        expect(output).toEqual({
            foo: 'bar'
        });
    });

    // https://www.vaultproject.io/api/secret/kv/kv-v2.html#read-secret-version
    it('parses K/V version 2 response', () => {
        const response = JSON.stringify({
            data: {
                data: {
                    foo: 'bar'
                }
            }
        })
        const output = parseResponse(response, 2);

        expect(output).toEqual({
            foo: 'bar'
        });
    });
});


describe('exportSecrets', () => {
    beforeEach(() => {
        jest.resetAllMocks();

        when(core.getInput)
            .calledWith('url')
            .mockReturnValueOnce('http://vault:8200');

        when(core.getInput)
            .calledWith('token')
            .mockReturnValueOnce('EXAMPLE');
    });

    function mockInput(key) {
        when(core.getInput)
            .calledWith('secrets')
            .mockReturnValueOnce(key);
    }

    function mockVersion(version) {
        when(core.getInput)
            .calledWith('kv-version')
            .mockReturnValueOnce(version);
    }

    function mockExtraHeaders(headerString) {
        when(core.getInput)
            .calledWith('extraHeaders')
            .mockReturnValueOnce(headerString);
    }

    function mockVaultData(data, version='2') {
        switch(version) {
            case '1':
                got.mockResolvedValue({
                    body: JSON.stringify({
                        data
                    })
                });
            break;
            case '2':
                got.mockResolvedValue({
                    body: JSON.stringify({
                        data: {
                            data
                        }
                    })
                });
            break;
        }
    }

    it('simple secret retrieval', async () => {
        mockInput('test key');
        mockVaultData({
            key: 1
        });

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('KEY', '1');
        expect(core.setOutput).toBeCalledWith('key', '1');
    });

    it('mapped secret retrieval', async () => {
        mockInput('test key|TEST_NAME');
        mockVaultData({
            key: 1
        });

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('TEST_NAME', '1');
        expect(core.setOutput).toBeCalledWith('TEST_NAME', '1');
    });

    it('simple secret retrieval from K/V v1', async () => {
        const version = '1';

        mockInput('test key');
        mockExtraHeaders(`
        TEST: 1
        `);
        mockVaultData({
            key: 1
        });

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('KEY', '1');
        expect(core.setOutput).toBeCalledWith('key', '1');
    });

    it('simple secret retrieval with extra headers', async () => {
        const version = '1';

        mockInput('test key');
        mockVersion(version);
        mockVaultData({
            key: 1
        }, version);

        await exportSecrets();

        expect(core.exportVariable).toBeCalledWith('KEY', '1');
        expect(core.setOutput).toBeCalledWith('key', '1');
    });
});
