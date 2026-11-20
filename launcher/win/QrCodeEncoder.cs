using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace OcarinaAtlasLauncher
{
    internal sealed class QrCodeEncoder
    {
        // Byte-mode capacity & Reed-Solomon parameters for Versions 1-6, ECC Level M.
        private static readonly int[] MaxBytes = { 0, 14, 26, 42, 62, 84, 106 };
        private static readonly int[] DataCodewords = { 0, 16, 28, 44, 64, 86, 108 };
        private static readonly int[] EcPerBlock = { 0, 10, 16, 26, 18, 24, 16 };
        private static readonly int[] BlockCount = { 0, 1, 1, 1, 2, 2, 4 };

        private static readonly int[] GfExp = new int[512];
        private static readonly int[] GfLog = new int[256];

        static QrCodeEncoder()
        {
            int x = 1;
            for (int i = 0; i < 255; i++)
            {
                GfExp[i] = x;
                GfLog[x] = i;
                x <<= 1;
                if ((x & 0x100) != 0)
                {
                    x ^= 0x11D;
                }
            }
            for (int i = 255; i < 512; i++)
            {
                GfExp[i] = GfExp[i - 255];
            }
        }

        public static bool[,] Encode(string text)
        {
            if (string.IsNullOrEmpty(text)) return null;
            byte[] utf8 = Encoding.UTF8.GetBytes(text);
            int version = 0;
            for (int v = 1; v <= 6; v++)
            {
                if (utf8.Length <= MaxBytes[v])
                {
                    version = v;
                    break;
                }
            }
            if (version == 0) return null;

            int dataCount = DataCodewords[version];
            byte[] dataBytes = BuildDataCodewords(utf8, dataCount);
            byte[] allCodewords = BuildInterleavedCodewords(dataBytes, version);

            int size = 17 + version * 4;
            bool[,] modules = new bool[size, size];
            bool[,] isFunction = new bool[size, size];

            PlaceFunctionPatterns(modules, isFunction, size, version);
            PlaceDataBits(modules, isFunction, size, allCodewords);

            int bestMask = 0;
            int bestPenalty = int.MaxValue;
            for (int mask = 0; mask < 8; mask++)
            {
                bool[,] trial = (bool[,])modules.Clone();
                ApplyMask(trial, isFunction, size, mask);
                WriteFormatInfo(trial, size, mask);
                int penalty = ComputePenalty(trial, size);
                if (penalty < bestPenalty)
                {
                    bestPenalty = penalty;
                    bestMask = mask;
                }
            }

            ApplyMask(modules, isFunction, size, bestMask);
            WriteFormatInfo(modules, size, bestMask);
            return modules;
        }

        public static Bitmap RenderBitmap(string text, int targetSizePx)
        {
            bool[,] matrix = Encode(text);
            if (matrix == null || targetSizePx <= 0) return null;

            int modules = matrix.GetLength(0);
            int totalModules = modules + 8; // ISO/IEC 18004 requires a 4-module quiet zone on each side
            int scale = Math.Max(1, targetSizePx / totalModules);
            int qrPx = modules * scale;
            int offset = (targetSizePx - qrPx) / 2;

            const int whiteArgb = unchecked((int)0xFFFFFFFF);
            const int blackArgb = unchecked((int)0xFF000000);

            int[] pixels = new int[targetSizePx * targetSizePx];
            for (int i = 0; i < pixels.Length; i++)
            {
                pixels[i] = whiteArgb;
            }

            for (int r = 0; r < modules; r++)
            {
                int baseY = offset + r * scale;
                for (int c = 0; c < modules; c++)
                {
                    if (!matrix[r, c]) continue;
                    int baseX = offset + c * scale;
                    for (int dy = 0; dy < scale; dy++)
                    {
                        int y = baseY + dy;
                        if (y < 0 || y >= targetSizePx) continue;
                        int rowOffset = y * targetSizePx;
                        for (int dx = 0; dx < scale; dx++)
                        {
                            int x = baseX + dx;
                            if (x >= 0 && x < targetSizePx)
                            {
                                pixels[rowOffset + x] = blackArgb;
                            }
                        }
                    }
                }
            }

            Bitmap bmp = new Bitmap(targetSizePx, targetSizePx, PixelFormat.Format32bppArgb);
            BitmapData data = bmp.LockBits(
                new Rectangle(0, 0, targetSizePx, targetSizePx),
                ImageLockMode.WriteOnly,
                PixelFormat.Format32bppArgb);
            try
            {
                Marshal.Copy(pixels, 0, data.Scan0, pixels.Length);
            }
            finally
            {
                bmp.UnlockBits(data);
            }
            return bmp;
        }

        private static byte[] BuildDataCodewords(byte[] utf8, int dataCount)
        {
            byte[] result = new byte[dataCount];
            int bitPos = 0;
            int capacityBits = dataCount * 8;

            AppendBits(result, ref bitPos, 0x4, 4);
            AppendBits(result, ref bitPos, utf8.Length, 8);
            for (int i = 0; i < utf8.Length; i++)
            {
                AppendBits(result, ref bitPos, utf8[i], 8);
            }

            int terminatorBits = Math.Min(4, capacityBits - bitPos);
            if (terminatorBits > 0)
            {
                AppendBits(result, ref bitPos, 0, terminatorBits);
            }

            int padByteStart = (bitPos + 7) / 8;
            for (int i = padByteStart; i < dataCount; i++)
            {
                result[i] = ((i - padByteStart) % 2 == 0) ? (byte)0xEC : (byte)0x11;
            }
            return result;
        }

        private static void AppendBits(byte[] buffer, ref int bitPos, int value, int bitCount)
        {
            for (int i = bitCount - 1; i >= 0; i--)
            {
                if (((value >> i) & 1) != 0)
                {
                    buffer[bitPos >> 3] |= (byte)(1 << (7 - (bitPos & 7)));
                }
                bitPos++;
            }
        }

        private static byte[] BuildInterleavedCodewords(byte[] data, int version)
        {
            int numBlocks = BlockCount[version];
            int ecCount = EcPerBlock[version];
            int dataPerBlock = data.Length / numBlocks;

            byte[] gen = BuildRsGenerator(ecCount);
            byte[][] dataBlocks = new byte[numBlocks][];
            byte[][] ecBlocks = new byte[numBlocks][];

            for (int b = 0; b < numBlocks; b++)
            {
                byte[] block = new byte[dataPerBlock];
                Array.Copy(data, b * dataPerBlock, block, 0, dataPerBlock);
                dataBlocks[b] = block;
                ecBlocks[b] = ComputeRsRemainder(block, gen, ecCount);
            }

            byte[] output = new byte[data.Length + numBlocks * ecCount];
            int idx = 0;
            for (int i = 0; i < dataPerBlock; i++)
            {
                for (int b = 0; b < numBlocks; b++)
                {
                    output[idx++] = dataBlocks[b][i];
                }
            }
            for (int i = 0; i < ecCount; i++)
            {
                for (int b = 0; b < numBlocks; b++)
                {
                    output[idx++] = ecBlocks[b][i];
                }
            }
            return output;
        }

        private static int GfMul(int a, int b)
        {
            if (a == 0 || b == 0) return 0;
            return GfExp[GfLog[a] + GfLog[b]];
        }

        private static byte[] BuildRsGenerator(int degree)
        {
            byte[] gen = new byte[degree + 1];
            gen[0] = 1;
            for (int i = 0; i < degree; i++)
            {
                int root = GfExp[i];
                for (int k = i + 1; k >= 1; k--)
                {
                    gen[k] = (byte)(gen[k] ^ GfMul(gen[k - 1], root));
                }
            }
            return gen;
        }

        private static byte[] ComputeRsRemainder(byte[] data, byte[] gen, int ecCount)
        {
            byte[] rem = new byte[ecCount];
            for (int i = 0; i < data.Length; i++)
            {
                byte factor = (byte)(data[i] ^ rem[0]);
                for (int j = 0; j < ecCount - 1; j++)
                {
                    rem[j] = rem[j + 1];
                }
                rem[ecCount - 1] = 0;
                if (factor != 0)
                {
                    for (int j = 0; j < ecCount; j++)
                    {
                        rem[j] = (byte)(rem[j] ^ GfMul(gen[j + 1], factor));
                    }
                }
            }
            return rem;
        }

        private static void PlaceFunctionPatterns(bool[,] modules, bool[,] isFunction, int size, int version)
        {
            PlaceFinderPattern(modules, isFunction, size, 0, 0);
            PlaceFinderPattern(modules, isFunction, size, 0, size - 7);
            PlaceFinderPattern(modules, isFunction, size, size - 7, 0);

            for (int i = 8; i < size - 8; i++)
            {
                bool dark = (i % 2) == 0;
                modules[6, i] = dark;
                isFunction[6, i] = true;
                modules[i, 6] = dark;
                isFunction[i, 6] = true;
            }

            if (version >= 2)
            {
                int center = size - 7;
                for (int dr = -2; dr <= 2; dr++)
                {
                    for (int dc = -2; dc <= 2; dc++)
                    {
                        modules[center + dr, center + dc] = Math.Max(Math.Abs(dr), Math.Abs(dc)) != 1;
                        isFunction[center + dr, center + dc] = true;
                    }
                }
            }

            // Reserve format info areas and dark module
            for (int i = 0; i <= 8; i++)
            {
                isFunction[8, i] = true;
                isFunction[i, 8] = true;
            }
            for (int c = size - 8; c < size; c++)
            {
                isFunction[8, c] = true;
            }
            for (int r = size - 8; r < size; r++)
            {
                isFunction[r, 8] = true;
            }
            modules[size - 8, 8] = true;
        }

        private static void PlaceFinderPattern(bool[,] modules, bool[,] isFunction, int size, int top, int left)
        {
            for (int dr = -1; dr <= 7; dr++)
            {
                int r = top + dr;
                if (r < 0 || r >= size) continue;
                for (int dc = -1; dc <= 7; dc++)
                {
                    int c = left + dc;
                    if (c < 0 || c >= size) continue;
                    int dist = Math.Max(Math.Abs(dr - 3), Math.Abs(dc - 3));
                    modules[r, c] = (dist != 2 && dist != 4);
                    isFunction[r, c] = true;
                }
            }
        }

        private static void PlaceDataBits(bool[,] modules, bool[,] isFunction, int size, byte[] codewords)
        {
            int bitIdx = 0;
            int totalBits = codewords.Length * 8;
            bool upward = true;

            for (int right = size - 1; right >= 1; right -= 2)
            {
                if (right == 6) right = 5;
                for (int vert = 0; vert < size; vert++)
                {
                    int r = upward ? (size - 1 - vert) : vert;
                    for (int j = 0; j < 2; j++)
                    {
                        int c = right - j;
                        if (!isFunction[r, c])
                        {
                            bool bit = false;
                            if (bitIdx < totalBits)
                            {
                                bit = ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) != 0;
                                bitIdx++;
                            }
                            modules[r, c] = bit;
                        }
                    }
                }
                upward = !upward;
            }
        }

        private static void ApplyMask(bool[,] modules, bool[,] isFunction, int size, int mask)
        {
            for (int r = 0; r < size; r++)
            {
                for (int c = 0; c < size; c++)
                {
                    if (isFunction[r, c]) continue;
                    bool invert = false;
                    switch (mask)
                    {
                        case 0: invert = ((r + c) % 2) == 0; break;
                        case 1: invert = (r % 2) == 0; break;
                        case 2: invert = (c % 3) == 0; break;
                        case 3: invert = ((r + c) % 3) == 0; break;
                        case 4: invert = (((r / 2) + (c / 3)) % 2) == 0; break;
                        case 5: invert = (((r * c) % 2) + ((r * c) % 3)) == 0; break;
                        case 6: invert = ((((r * c) % 2) + ((r * c) % 3)) % 2) == 0; break;
                        case 7: invert = ((((r + c) % 2) + ((r * c) % 3)) % 2) == 0; break;
                    }
                    if (invert)
                    {
                        modules[r, c] = !modules[r, c];
                    }
                }
            }
        }

        private static void WriteFormatInfo(bool[,] modules, int size, int mask)
        {
            // ECC Level M = 00
            int data = mask & 0x7;
            int rem = data << 10;
            for (int i = 4; i >= 0; i--)
            {
                if (((rem >> (i + 10)) & 1) != 0)
                {
                    rem ^= (0x537 << i);
                }
            }
            int bits = ((data << 10) | rem) ^ 0x5412;

            for (int i = 0; i <= 5; i++)
            {
                modules[8, i] = ((bits >> (14 - i)) & 1) != 0;
            }
            modules[8, 7] = ((bits >> 8) & 1) != 0;
            modules[8, 8] = ((bits >> 7) & 1) != 0;
            modules[7, 8] = ((bits >> 6) & 1) != 0;
            for (int i = 9; i < 15; i++)
            {
                modules[14 - i, 8] = ((bits >> (14 - i)) & 1) != 0;
            }

            for (int i = 0; i < 7; i++)
            {
                modules[size - 1 - i, 8] = ((bits >> (14 - i)) & 1) != 0;
            }
            for (int i = 7; i < 15; i++)
            {
                modules[8, size - 15 + i] = ((bits >> (14 - i)) & 1) != 0;
            }
        }

        private static int ComputePenalty(bool[,] modules, int size)
        {
            int penalty = 0;

            // N1: 5+ consecutive modules in row or col
            for (int r = 0; r < size; r++)
            {
                int run = 1;
                for (int c = 1; c < size; c++)
                {
                    if (modules[r, c] == modules[r, c - 1])
                    {
                        run++;
                        if (run == 5) penalty += 3;
                        else if (run > 5) penalty += 1;
                    }
                    else
                    {
                        run = 1;
                    }
                }
            }
            for (int c = 0; c < size; c++)
            {
                int run = 1;
                for (int r = 1; r < size; r++)
                {
                    if (modules[r, c] == modules[r - 1, c])
                    {
                        run++;
                        if (run == 5) penalty += 3;
                        else if (run > 5) penalty += 1;
                    }
                    else
                    {
                        run = 1;
                    }
                }
            }

            // N2: 2x2 blocks of same color
            for (int r = 0; r < size - 1; r++)
            {
                for (int c = 0; c < size - 1; c++)
                {
                    bool v = modules[r, c];
                    if (modules[r, c + 1] == v && modules[r + 1, c] == v && modules[r + 1, c + 1] == v)
                    {
                        penalty += 3;
                    }
                }
            }

            // N3: 1:1:3:1:1 finder-like pattern preceded or followed by 4 light modules
            for (int r = 0; r < size; r++)
            {
                for (int c = 0; c <= size - 11; c++)
                {
                    if (IsFinderLikeRow(modules, r, c))
                    {
                        penalty += 40;
                    }
                }
            }
            for (int c = 0; c < size; c++)
            {
                for (int r = 0; r <= size - 11; r++)
                {
                    if (IsFinderLikeCol(modules, r, c))
                    {
                        penalty += 40;
                    }
                }
            }

            // N4: dark module ratio deviation from 50%
            int dark = 0;
            for (int r = 0; r < size; r++)
            {
                for (int c = 0; c < size; c++)
                {
                    if (modules[r, c]) dark++;
                }
            }
            int total = size * size;
            int k = Math.Abs(dark * 20 - total * 10) / total;
            penalty += k * 10;

            return penalty;
        }

        private static bool IsFinderLikeRow(bool[,] modules, int r, int c)
        {
            // 1011101 + 0000 or 0000 + 1011101
            bool forward =
                modules[r, c] && !modules[r, c + 1] && modules[r, c + 2] && modules[r, c + 3] &&
                modules[r, c + 4] && !modules[r, c + 5] && modules[r, c + 6] &&
                !modules[r, c + 7] && !modules[r, c + 8] && !modules[r, c + 9] && !modules[r, c + 10];
            bool backward =
                !modules[r, c] && !modules[r, c + 1] && !modules[r, c + 2] && !modules[r, c + 3] &&
                modules[r, c + 4] && !modules[r, c + 5] && modules[r, c + 6] && modules[r, c + 7] &&
                modules[r, c + 8] && !modules[r, c + 9] && modules[r, c + 10];
            return forward || backward;
        }

        private static bool IsFinderLikeCol(bool[,] modules, int r, int c)
        {
            bool forward =
                modules[r, c] && !modules[r + 1, c] && modules[r + 2, c] && modules[r + 3, c] &&
                modules[r + 4, c] && !modules[r + 5, c] && modules[r + 6, c] &&
                !modules[r + 7, c] && !modules[r + 8, c] && !modules[r + 9, c] && !modules[r + 10, c];
            bool backward =
                !modules[r, c] && !modules[r + 1, c] && !modules[r + 2, c] && !modules[r + 3, c] &&
                modules[r + 4, c] && !modules[r + 5, c] && modules[r + 6, c] && modules[r + 7, c] &&
                modules[r + 8, c] && !modules[r + 9, c] && modules[r + 10, c];
            return forward || backward;
        }
    }
}
